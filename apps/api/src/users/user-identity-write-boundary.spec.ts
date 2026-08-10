import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const sourceRoot = dirname(__dirname);
const allowed = new Set([
  'database/entities/user.entity.ts',
  'database/migrations',
  'users/user-identity.service.ts',
  'users/user-identity-merge.service.ts',
]);
const protectedProperties = new Set([
  'phone',
  'phoneVerified',
  'phone_verified',
]);

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const absolute = join(directory, name);
    const relativePath = relative(sourceRoot, absolute).replaceAll('\\', '/');
    if (
      [...allowed].some(
        (entry) =>
          relativePath === entry || relativePath.startsWith(`${entry}/`),
      )
    ) {
      return [];
    }
    if (statSync(absolute).isDirectory()) return sourceFiles(absolute);
    return extname(name) === '.ts' && !name.endsWith('.spec.ts')
      ? [absolute]
      : [];
  });

const unwrapExpression = (expression: ts.Expression): ts.Expression => {
  if (
    ts.isAwaitExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return unwrapExpression(expression.expression);
  }
  return expression;
};

const typeNamesUser = (type: ts.TypeNode | undefined): boolean =>
  type !== undefined && /(?:^|\W)User(?:\W|$)/u.test(type.getText());

const typeNamesUserRepository = (type: ts.TypeNode | undefined): boolean =>
  type !== undefined && /Repository\s*<\s*User\s*>/u.test(type.getText());

const isGetUserRepositoryCall = (node: ts.CallExpression): boolean =>
  ts.isPropertyAccessExpression(node.expression) &&
  node.expression.name.text === 'getRepository' &&
  node.arguments.length > 0 &&
  ts.isIdentifier(node.arguments[0]) &&
  node.arguments[0].text === 'User';

const callTargetsUser = (node: ts.CallExpression): boolean =>
  ts.isPropertyAccessExpression(node.expression) &&
  ['from', 'into', 'update'].includes(node.expression.name.text) &&
  node.arguments.some(
    (argument) => ts.isIdentifier(argument) && argument.text === 'User',
  );

const isUserRepositoryExpression = (
  expression: ts.Expression,
  repositoryNames: ReadonlySet<string>,
): boolean => {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    return repositoryNames.has(unwrapped.text);
  }
  if (ts.isPropertyAccessExpression(unwrapped)) {
    return repositoryNames.has(unwrapped.name.text);
  }
  if (!ts.isCallExpression(unwrapped)) return false;
  if (isGetUserRepositoryCall(unwrapped) || callTargetsUser(unwrapped)) {
    return true;
  }
  return (
    ts.isPropertyAccessExpression(unwrapped.expression) &&
    isUserRepositoryExpression(unwrapped.expression.expression, repositoryNames)
  );
};

const isUserEntityExpression = (
  expression: ts.Expression,
  repositoryNames: ReadonlySet<string>,
  entityNames: ReadonlySet<string>,
): boolean => {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) return entityNames.has(unwrapped.text);
  if (ts.isPropertyAccessExpression(unwrapped)) {
    return entityNames.has(unwrapped.name.text);
  }
  if (
    ts.isNewExpression(unwrapped) &&
    ts.isIdentifier(unwrapped.expression) &&
    unwrapped.expression.text === 'User'
  ) {
    return true;
  }
  if (
    !ts.isCallExpression(unwrapped) ||
    !ts.isPropertyAccessExpression(unwrapped.expression)
  ) {
    return false;
  }
  return (
    [
      'create',
      'findOne',
      'findOneBy',
      'findOneOrFail',
      'findOneByOrFail',
      'merge',
      'preload',
      'save',
    ].includes(unwrapped.expression.name.text) &&
    isUserRepositoryExpression(unwrapped.expression.expression, repositoryNames)
  );
};

const objectWritesProtectedIdentity = (
  expression: ts.Expression,
  objectInitializers: ReadonlyMap<string, ts.Expression>,
  repositoryNames: ReadonlySet<string>,
  entityNames: ReadonlySet<string>,
  visited = new Set<string>(),
): boolean => {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    if (visited.has(unwrapped.text)) return false;
    const initializer = objectInitializers.get(unwrapped.text);
    if (initializer === undefined) return false;
    visited.add(unwrapped.text);
    return objectWritesProtectedIdentity(
      initializer,
      objectInitializers,
      repositoryNames,
      entityNames,
      visited,
    );
  }
  if (!ts.isObjectLiteralExpression(unwrapped)) return false;
  return unwrapped.properties.some((property) => {
    if (ts.isSpreadAssignment(property)) {
      return (
        isUserEntityExpression(
          property.expression,
          repositoryNames,
          entityNames,
        ) ||
        objectWritesProtectedIdentity(
          property.expression,
          objectInitializers,
          repositoryNames,
          entityNames,
          new Set(visited),
        )
      );
    }
    if (
      !ts.isPropertyAssignment(property) &&
      !ts.isShorthandPropertyAssignment(property)
    ) {
      return false;
    }
    const name = property.name;
    return (
      (ts.isIdentifier(name) || ts.isStringLiteral(name)) &&
      protectedProperties.has(name.text)
    );
  });
};

const callWritesProtectedIdentity = (
  node: ts.CallExpression,
  objectInitializers: ReadonlyMap<string, ts.Expression>,
  repositoryNames: ReadonlySet<string>,
  entityNames: ReadonlySet<string>,
): boolean => {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const method = node.expression.name.text;
  if (!['create', 'save', 'update', 'upsert', 'set'].includes(method)) {
    return false;
  }
  if (
    !isUserRepositoryExpression(node.expression.expression, repositoryNames)
  ) {
    return false;
  }
  return node.arguments.some((argument) =>
    objectWritesProtectedIdentity(
      argument,
      objectInitializers,
      repositoryNames,
      entityNames,
    ),
  );
};

const forbiddenWritesInSource = (
  sourceText: string,
  fileName = 'fixture.ts',
): string[] => {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const objectInitializers = new Map<string, ts.Expression>();
  const repositoryNames = new Set<string>();
  const entityNames = new Set<string>();
  const collectSources = (node: ts.Node): void => {
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      if (typeNamesUserRepository(node.type)) {
        repositoryNames.add(node.name.text);
      } else if (typeNamesUser(node.type)) {
        entityNames.add(node.name.text);
      }
    }
    if (
      ts.isPropertyDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      typeNamesUserRepository(node.type)
    ) {
      repositoryNames.add(node.name.text);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (typeNamesUserRepository(node.type)) {
        repositoryNames.add(node.name.text);
      }
      if (typeNamesUser(node.type) && !typeNamesUserRepository(node.type)) {
        entityNames.add(node.name.text);
      }
      if (node.initializer !== undefined) {
        objectInitializers.set(node.name.text, node.initializer);
        if (isUserRepositoryExpression(node.initializer, repositoryNames)) {
          repositoryNames.add(node.name.text);
        }
        if (
          isUserEntityExpression(node.initializer, repositoryNames, entityNames)
        ) {
          entityNames.add(node.name.text);
        }
      }
    }
    ts.forEachChild(node, collectSources);
  };
  collectSources(source);

  const findings: string[] = [];
  const reportedStarts = new Set<number>();
  const report = (node: ts.Node): void => {
    const start = node.getStart(source);
    if (reportedStarts.has(start)) return;
    reportedStarts.add(start);
    findings.push(
      `${fileName}:${source.getLineAndCharacterOfPosition(start).line + 1}`,
    );
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      protectedProperties.has(node.left.name.text) &&
      isUserEntityExpression(node.left.expression, repositoryNames, entityNames)
    ) {
      report(node);
    }
    if (
      ts.isCallExpression(node) &&
      callWritesProtectedIdentity(
        node,
        objectInitializers,
        repositoryNames,
        entityNames,
      )
    ) {
      report(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
};

const forbiddenWrites = (file: string): string[] =>
  forbiddenWritesInSource(
    readFileSync(file, 'utf8'),
    relative(sourceRoot, file).replaceAll('\\', '/'),
  );

describe('User identity write boundary AST scanner', () => {
  it.each([
    ['直接赋值', 'declare const user: User; user.phoneVerified = true;'],
    [
      'repository save 前变更',
      'declare const user: User; declare const users: Repository<User>; user.phone = phone; await users.save(user);',
    ],
    [
      'repository create object',
      'await manager.getRepository(User).save(manager.getRepository(User).create({ phone, phoneVerified: true }));',
    ],
    [
      'repository update object',
      'await manager.getRepository(User).update(id, { phoneVerified: true });',
    ],
    [
      'query builder set object',
      "await manager.getRepository(User).createQueryBuilder().update(User).set({ phone: '1' }).execute();",
    ],
  ])('识别%s', (_label, source) => {
    expect(forbiddenWritesInSource(source)).not.toEqual([]);
  });

  it('追踪 getRepository(User) 调用链与变量中的身份字段写入', () => {
    const source = [
      "manager.getRepository(User).update('1', { phoneVerified: true });",
      "dataSource.getRepository(User).save({ ...user, phone: '13800000000' });",
      'const repo = transaction.getRepository(User);',
      "repo.create({ phone: '13800000001', phoneVerified: false });",
      "repo.upsert({ phone: '13800000002' }, ['id']);",
      "repo.update('1', { phoneVerified: true });",
      'manager.getRepository(User).createQueryBuilder().update().set({ phoneVerified: true });',
      "class Fixture { constructor(private users: Repository<User>) {} write() { this.users.update('1', { phoneVerified: true }); } }",
    ].join('\n');

    expect(forbiddenWritesInSource(source, 'repository-fixture.ts')).toEqual([
      'repository-fixture.ts:1',
      'repository-fixture.ts:2',
      'repository-fixture.ts:4',
      'repository-fixture.ts:5',
      'repository-fixture.ts:6',
      'repository-fixture.ts:7',
      'repository-fixture.ts:8',
    ]);
  });

  it('忽略非 User repository 与无法可靠类型化的普通属性赋值', () => {
    const source = [
      "manager.getRepository(Address).update('1', { phone: '13800000000' });",
      "address.phone = '13800000001';",
      "dto.phone = '13800000002';",
      "const payload = { phone: '13800000003' };",
      "manager.getRepository(User).update('1', { nickname: '新昵称' });",
    ].join('\n');

    expect(forbiddenWritesInSource(source, 'non-user-fixture.ts')).toEqual([]);
  });

  it('不因普通读取或不相关对象写入而误报', () => {
    expect(
      forbiddenWritesInSource(
        'const phone = user.phone; await repository.update(id, { nickname: phone });',
      ),
    ).toEqual([]);
  });
});

describe('User identity write boundary', () => {
  it('禁止生产源码绕过 UserIdentityService 写 users.phone/phone_verified', () => {
    expect(sourceFiles(sourceRoot).flatMap(forbiddenWrites)).toEqual([]);
  });
});
