import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const ENUM_NAMES = new Set([
  'AdminPermission',
  'ApiErrorCode',
  'CloudPrinterOnlineStatus',
  'CloudPrinterStatus',
  'FulfillmentType',
  'ManualPrintResolution',
  'OrderStatus',
  'PrintBatchStatus',
  'PrintJobStatus',
  'PrinterBindingStage',
  'VendorRelationState',
]);
const PRINTING_RUNTIME_NAMES = new Set([
  'CLOUD_PRINTER_DISPLAY_NAME_MAX_LENGTH',
  'CLOUD_PRINTER_SERIAL_NUMBER_PATTERN',
  'normalizeCloudPrinterDisplayName',
  'normalizeCloudPrinterSerialNumber',
]);
const contractsRoot = new URL(
  '../../../packages/shared-contracts/src/',
  import.meta.url,
);
const outputUrl = new URL('../config/contracts.generated.ts', import.meta.url);

/**
 * @param {string} source
 * @param {ReadonlySet<string>} names
 * @returns {readonly { name: string, source: string }[]}
 */
function selectedDeclarations(source, names) {
  const file = ts.createSourceFile(
    'contracts-runtime.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return file.statements.flatMap((statement) => {
    if (
      ts.isEnumDeclaration(statement) ||
      ts.isFunctionDeclaration(statement)
    ) {
      return statement.name && names.has(statement.name.text)
        ? [{ name: statement.name.text, source: statement.getText(file) }]
        : [];
    }
    if (!ts.isVariableStatement(statement)) return [];
    const selectedNames = statement.declarationList.declarations.flatMap(
      (declaration) =>
        ts.isIdentifier(declaration.name) && names.has(declaration.name.text)
          ? [declaration.name.text]
          : [],
    );
    return selectedNames.map((name) => ({
      name,
      source: statement.getText(file),
    }));
  });
}

const [enumsSource, printingSource] = await Promise.all([
  readFile(new URL('enums.ts', contractsRoot), 'utf8'),
  readFile(new URL('printing.ts', contractsRoot), 'utf8'),
]);
const declarations = [
  ...selectedDeclarations(enumsSource, ENUM_NAMES),
  ...selectedDeclarations(printingSource, PRINTING_RUNTIME_NAMES),
];
const names = new Set(declarations.map(({ name }) => name));
const expectedNames = new Set([...ENUM_NAMES, ...PRINTING_RUNTIME_NAMES]);
if (
  names.size !== expectedNames.size ||
  [...expectedNames].some((name) => !names.has(name))
) {
  throw new Error('shared contracts runtime declarations are incomplete');
}

await writeFile(
  outputUrl,
  `// Generated from the shared contracts package. Do not edit.\n${declarations
    .map(({ source }) => source)
    .join('\n\n')}\n`,
  { encoding: 'utf8', mode: 0o600 },
);
console.log(
  `generated miniapp contracts runtime at ${fileURLToPath(outputUrl)}`,
);
