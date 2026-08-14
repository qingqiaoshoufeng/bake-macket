import { readFile, readdir } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';

import ts from 'typescript';

const sourceExtensions = new Set(['.js', '.mjs', '.ts']);
const networkMethods = new Set([
  'connectSocket',
  'downloadFile',
  'request',
  'sendSocketMessage',
  'uploadFile',
]);

/**
 * @typedef {{ filePath: string, line: number, column: number, message: string }} SourceBoundaryDiagnostic
 * @typedef {{ filePath: string, packageRoot: string, source: string }} SourceInput
 */

/** @param {ts.Expression} expression */
function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * @param {ts.Expression} expression
 * @param {ReadonlyMap<string, string>} stringConstants
 */
function staticString(expression, stringConstants) {
  const current = unwrapExpression(expression);
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isIdentifier(current))
    return stringConstants.get(current.text) ?? null;
  return null;
}

/**
 * @param {ts.Expression} expression
 * @param {ReadonlySet<string>} wxAliases
 */
function isWxReference(expression, wxAliases) {
  const current = unwrapExpression(expression);
  return ts.isIdentifier(current) && wxAliases.has(current.text);
}

/** @param {ts.BindingName} name @param {string} expected @returns {boolean} */
function bindingContains(name, expected) {
  if (ts.isIdentifier(name)) return name.text === expected;
  return name.elements.some(
    (element) =>
      !ts.isOmittedExpression(element) &&
      bindingContains(element.name, expected),
  );
}

/** @param {ts.CallExpression} call @param {string} localName */
function isShadowedAtCall(call, localName) {
  let current = call.parent;
  while (current && !ts.isSourceFile(current)) {
    if (
      (ts.isFunctionLike(current) &&
        current.parameters.some((parameter) =>
          bindingContains(parameter.name, localName),
        )) ||
      ((ts.isBlock(current) || ts.isModuleBlock(current)) &&
        current.statements.some(
          (statement) =>
            ts.isVariableStatement(statement) &&
            statement.declarationList.declarations.some((declaration) =>
              bindingContains(declaration.name, localName),
            ),
        ))
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** @param {string} filePath */
function scriptKind(filePath) {
  return extname(filePath) === '.ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

/** @param {string} value */
function portablePath(value) {
  return value.replaceAll('\\', '/');
}

/** @param {ts.SourceFile} sourceFile @param {ts.Node} node @param {string} message */
function diagnostic(sourceFile, node, message) {
  const position = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return {
    filePath: sourceFile.fileName,
    line: position.line + 1,
    column: position.character + 1,
    message,
  };
}

/**
 * Analyze one source file without executing it.
 *
 * @param {SourceInput} input
 * @returns {readonly SourceBoundaryDiagnostic[]}
 */
export function analyzeMiniappSource({ filePath, packageRoot, source }) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(filePath),
  );
  /** @type {SourceBoundaryDiagnostic[]} */
  const diagnostics = [];
  /** @type {Map<string, string>} */
  const stringConstants = new Map();
  /** @type {Set<string>} */
  const wxAliases = new Set(['wx']);
  /** @type {ts.Node[]} */
  const nodes = [];

  /** @param {ts.Node} node */
  function visit(node) {
    nodes.push(node);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const value = staticString(node.initializer, stringConstants);
      if (value !== null) stringConstants.set(node.name.text, value);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      let target;
      let value;
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        target = node.name.text;
        value = node.initializer;
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)
      ) {
        target = node.left.text;
        value = node.right;
      }
      if (
        target &&
        value &&
        isWxReference(value, wxAliases) &&
        !wxAliases.has(target)
      ) {
        wxAliases.add(target);
        changed = true;
      }
    }
  }

  const canonicalClientPath = resolve(packageRoot, 'utils/api-client.ts');
  const isCanonicalClient = resolve(filePath) === canonicalClientPath;
  for (const node of nodes) {
    let owner;
    let method = null;
    if (ts.isPropertyAccessExpression(node)) {
      owner = node.expression;
      method = node.name.text;
    } else if (ts.isElementAccessExpression(node)) {
      owner = node.expression;
      method = node.argumentExpression
        ? staticString(node.argumentExpression, stringConstants)
        : null;
    }
    if (
      owner &&
      isWxReference(owner, wxAliases) &&
      (method === null || networkMethods.has(method)) &&
      (!isCanonicalClient || method !== 'request')
    ) {
      diagnostics.push(
        diagnostic(
          sourceFile,
          node,
          isCanonicalClient
            ? 'utils/api-client.ts 只能调用 wx.request'
            : '微信网络 API 只能由 utils/api-client.ts 调用',
        ),
      );
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      isWxReference(node.initializer, wxAliases)
    ) {
      for (const element of node.name.elements) {
        const property = element.propertyName ?? element.name;
        const name = ts.isIdentifier(property)
          ? property.text
          : ts.isStringLiteralLike(property)
            ? property.text
            : null;
        if (
          (name === null || networkMethods.has(name)) &&
          (!isCanonicalClient || name !== 'request')
        ) {
          diagnostics.push(
            diagnostic(
              sourceFile,
              element,
              isCanonicalClient
                ? 'utils/api-client.ts 只能调用 wx.request'
                : '微信网络 API 只能由 utils/api-client.ts 调用',
            ),
          );
        }
      }
    }
  }

  const relativePath = portablePath(relative(packageRoot, filePath));
  const isAdminFeatureApi =
    relativePath.startsWith('admin/') &&
    relativePath.includes('/api/') &&
    relativePath.endsWith('.ts') &&
    !relativePath.endsWith('.spec.ts');
  if (isAdminFeatureApi) {
    const clientBindings = new Set();
    for (const node of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(node) ||
        !ts.isStringLiteral(node.moduleSpecifier)
      ) {
        continue;
      }
      const importedPath = resolve(
        filePath,
        '..',
        node.moduleSpecifier.text.replace(/\.[cm]?[jt]s$/, '.ts'),
      );
      if (
        importedPath !== canonicalClientPath ||
        !node.importClause?.namedBindings ||
        !ts.isNamedImports(node.importClause.namedBindings)
      ) {
        continue;
      }
      for (const element of node.importClause.namedBindings.elements) {
        if (
          (element.propertyName ?? element.name).text ===
          'createMiniappApiClient'
        ) {
          clientBindings.add(element.name.text);
        }
      }
    }

    const hasRealClientCall = nodes.some((node) => {
      if (!ts.isCallExpression(node)) return false;
      const expression = unwrapExpression(node.expression);
      return (
        ts.isIdentifier(expression) &&
        clientBindings.has(expression.text) &&
        !isShadowedAtCall(node, expression.text)
      );
    });
    if (!hasRealClientCall) {
      diagnostics.push(
        diagnostic(
          sourceFile,
          sourceFile,
          '原生管理 API 必须实际调用从 utils/api-client 导入的 createMiniappApiClient',
        ),
      );
    }
  }

  return diagnostics;
}

/** @param {string} directory @returns {Promise<readonly string[]>} */
async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  /** @type {readonly (readonly string[])[]} */
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return entry.name === 'node_modules'
          ? []
          : collectSourceFiles(absolutePath);
      }
      return sourceExtensions.has(extname(entry.name)) &&
        !entry.name.endsWith('.spec.ts') &&
        !entry.name.endsWith('.spec.mjs') &&
        !entry.name.endsWith('.d.ts')
        ? [absolutePath]
        : [];
    }),
  );
  return nested.flat();
}

/**
 * @param {string} packageRoot
 * @returns {Promise<readonly SourceBoundaryDiagnostic[]>}
 */
export async function scanMiniappSourceBoundary(packageRoot) {
  const files = await collectSourceFiles(packageRoot);
  const results = await Promise.all(
    files.map(async (filePath) =>
      analyzeMiniappSource({
        filePath,
        packageRoot,
        source: await readFile(filePath, 'utf8'),
      }),
    ),
  );
  return results.flat();
}
