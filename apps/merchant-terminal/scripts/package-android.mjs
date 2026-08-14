import { execFile, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import yauzl from 'yauzl';

const execFileAsync = promisify(execFile);
const HBUILDERX_COMMAND_TIMEOUT_MS = 60_000;
const HBUILDERX_PACK_TIMEOUT_MS = 15 * 60_000;

class SafeAndroidPackageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SafeAndroidPackageError';
    this.code = code;
  }
}

const safePackageError = (code, message) =>
  new SafeAndroidPackageError(code, message);

const describeHBuilderXOperation = (arguments_) =>
  arguments_[0] === 'pack' ? 'pack' : arguments_.slice(0, 2).join(' ');

export const executeHBuilderX = async (
  command,
  arguments_,
  executeFile = execFileAsync,
) => {
  const operation = describeHBuilderXOperation(arguments_);
  const timeout =
    arguments_[0] === 'pack'
      ? HBUILDERX_PACK_TIMEOUT_MS
      : HBUILDERX_COMMAND_TIMEOUT_MS;

  try {
    const { stdout, stderr } = await executeFile(command, arguments_, {
      encoding: 'utf8',
      windowsHide: true,
      timeout,
    });
    return `${stdout}${stderr}`.trim();
  } catch (error) {
    const timedOut =
      error?.code === 'ETIMEDOUT' ||
      error?.killed === true ||
      error?.signal === 'SIGTERM' ||
      error?.signal === 'SIGKILL';
    throw new Error(
      `HBuilderX ${operation} ${timedOut ? 'timed out' : 'failed'}.`,
    );
  }
};

const defaultExecute = executeHBuilderX;

const defaultIsPathIgnored = async (filePath) => {
  const result = spawnSync('git', ['check-ignore', '--quiet', '--', filePath], {
    cwd: dirname(filePath),
    stdio: 'ignore',
    windowsHide: true,
  });
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    throw new Error('Unable to verify the signing config Git ignore status.');
  }

  return result.status === 0;
};

const readPackConfig = async (configPath, readFilePath) => {
  let source;
  try {
    source = await readFilePath(configPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('HBuilderX pack config no longer exists.');
    }
    throw new Error('Unable to read HBuilderX pack config.');
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('Invalid HBuilderX pack config JSON.');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    parsed.platform !== 'android' ||
    typeof parsed.project !== 'string'
  ) {
    throw new Error(
      'HBuilderX pack config requires project and platform=android.',
    );
  }
  if (parsed.safemode !== true) {
    throw new Error('HBuilderX pack config requires safemode=true.');
  }

  return parsed;
};

const canonicalPath = async (filePath, realpathPath) => {
  try {
    return await realpathPath(filePath);
  } catch {
    throw new Error('Unable to resolve App Android resource paths.');
  }
};

const equalCanonicalPaths = (left, right, platform) =>
  platform === 'win32'
    ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
    : left === right;

const isDirectory = async (directory, statPath) => {
  try {
    return (await statPath(directory)).isDirectory();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw new Error('Unable to check App Android resources.');
  }
};

const requireResourceDirectory = async (directories, statPath) => {
  const directoryChecks = await Promise.all(
    directories.map((directory) => isDirectory(directory, statPath)),
  );
  const directory = directories.find(
    (_candidate, index) => directoryChecks[index],
  );
  if (!directory) {
    throw new Error(
      'Missing App Android resources. Run pnpm build:app-resources first.',
    );
  }

  return directory;
};

const requireFile = async (filePath, message, accessMessage, statPath) => {
  try {
    if (!(await statPath(filePath)).isFile()) throw new Error(message);
  } catch (error) {
    if (error?.code && error.code !== 'ENOENT') throw new Error(accessMessage);
    throw new Error(message);
  }
};

const reservePreviousArtifact = async (
  filePath,
  statPath,
  renamePath,
  createBackupName,
) => {
  try {
    const artifactStat = await statPath(filePath);
    if (!artifactStat.isFile()) {
      throw new Error(
        'Configured Android package output must be a regular file.',
      );
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const backupPath = `${filePath}.backup-${createBackupName()}`;
    try {
      await statPath(backupPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      try {
        await renamePath(filePath, backupPath);
        return backupPath;
      } catch (renameError) {
        if (renameError?.code === 'EEXIST') continue;
        throw renameError;
      }
    }
  }
  throw new Error('Unable to reserve a unique Android package backup.');
};

const restorePreviousArtifact = async (
  outputPath,
  backupPath,
  removePath,
  renamePath,
) => {
  if (!backupPath) {
    await removePath(outputPath, { force: true });
    return;
  }
  await removePath(outputPath, { force: true });
  await renamePath(backupPath, outputPath);
};

const fromBuffer = promisify(yauzl.fromBuffer);
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_DATA_DESCRIPTOR_FLAG = 0x0008;
const APK_XML_TYPE = 0x0003;
const APK_STRING_POOL_TYPE = 0x0001;
const APK_START_ELEMENT_TYPE = 0x0102;
const APK_END_ELEMENT_TYPE = 0x0103;
const APK_XML_HEADER_SIZE = 8;
const APK_XML_NODE_HEADER_SIZE = 16;
const APK_START_ELEMENT_EXT_SIZE = 20;
const APK_END_ELEMENT_EXT_SIZE = 8;
const APK_ATTRIBUTE_SIZE = 20;
const APK_NO_STRING_INDEX = 0xffffffff;
const UTF8_STRING_POOL_FLAG = 0x00000100;
const DEFAULT_ARCHIVE_LIMITS = Object.freeze({
  maxPackageBytes: 1024 * 1024 * 1024,
  maxManifestCompressedBytes: 16 * 1024 * 1024,
  maxManifestUncompressedBytes: 32 * 1024 * 1024,
  maxManifestCompressionRatio: 200,
  maxManifestStreamBytes: 32 * 1024 * 1024,
  maxProtobufFields: 10_000,
  maxProtobufDepth: 16,
});

const requirePositiveLimit = (value, name) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid Android archive limit: ${name}.`);
  }
  return value;
};

const resolveArchiveLimits = (overrides = {}) =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(DEFAULT_ARCHIVE_LIMITS).map(([name, defaultValue]) => [
        name,
        requirePositiveLimit(overrides[name] ?? defaultValue, name),
      ]),
    ),
  );

const readLocalMetadata = (bytes, entry) => {
  const offset = entry.relativeOffsetOfLocalHeader;
  if (
    offset < 0 ||
    offset + 30 > bytes.length ||
    bytes.readUInt32LE(offset) !== ZIP_LOCAL_SIGNATURE
  ) {
    throw new Error('Invalid ZIP local header.');
  }
  const nameLength = bytes.readUInt16LE(offset + 26);
  const extraLength = bytes.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  if (dataOffset + entry.compressedSize > bytes.length) {
    throw new Error('Invalid ZIP entry bounds.');
  }
  return {
    flags: bytes.readUInt16LE(offset + 6),
    method: bytes.readUInt16LE(offset + 8),
    crc32: bytes.readUInt32LE(offset + 14),
    compressedSize: bytes.readUInt32LE(offset + 18),
    uncompressedSize: bytes.readUInt32LE(offset + 22),
    name: bytes.subarray(offset + 30, offset + 30 + nameLength).toString(),
  };
};

const requireMatchingLocalMetadata = (bytes, entry) => {
  const local = readLocalMetadata(bytes, entry);
  const usesDescriptor =
    (entry.generalPurposeBitFlag & ZIP_DATA_DESCRIPTOR_FLAG) !== 0;
  if (
    local.name !== entry.fileName ||
    local.flags !== entry.generalPurposeBitFlag ||
    local.method !== entry.compressionMethod ||
    (!usesDescriptor &&
      (local.crc32 !== entry.crc32 ||
        local.compressedSize !== entry.compressedSize ||
        local.uncompressedSize !== entry.uncompressedSize))
  ) {
    throw new Error('ZIP central and local headers conflict.');
  }
};

const readEntryBytes = (zipFile, entry, maxStreamBytes) =>
  new Promise((resolveEntry, rejectEntry) => {
    zipFile.openReadStream(entry, (openError, stream) => {
      if (openError) {
        rejectEntry(openError);
        return;
      }
      const chunks = [];
      let bytesRead = 0;
      let settled = false;
      const rejectOnce = (error) => {
        if (settled) return;
        settled = true;
        stream.destroy();
        rejectEntry(error);
      };
      stream.on('data', (chunk) => {
        bytesRead += chunk.length;
        if (bytesRead > maxStreamBytes) {
          rejectOnce(
            new Error('ZIP manifest stream exceeds its resource limit.'),
          );
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      stream.once('error', rejectOnce);
      stream.once('end', () => {
        if (settled) return;
        settled = true;
        resolveEntry(Buffer.concat(chunks, bytesRead));
      });
    });
  });

const crc32 = (bytes) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const findEntry = (zipFile, expectedName) =>
  new Promise((resolveEntry, rejectEntry) => {
    let settled = false;
    zipFile.once('error', rejectEntry);
    zipFile.on('entry', (entry) => {
      if (settled) return;
      if (entry.fileName === expectedName) {
        settled = true;
        resolveEntry(entry);
        return;
      }
      zipFile.readEntry();
    });
    zipFile.once('end', () => {
      if (!settled) resolveEntry(null);
    });
    zipFile.readEntry();
  });

const readLength8 = (bytes, offset, limit) => {
  if (offset >= limit) return null;
  const first = bytes[offset];
  if ((first & 0x80) === 0) return { value: first, nextOffset: offset + 1 };
  if (offset + 1 >= limit) return null;
  return {
    value: ((first & 0x7f) << 8) | bytes[offset + 1],
    nextOffset: offset + 2,
  };
};

const readLength16 = (bytes, offset, limit) => {
  if (offset + 2 > limit) return null;
  const first = bytes.readUInt16LE(offset);
  if ((first & 0x8000) === 0) {
    return { value: first, nextOffset: offset + 2 };
  }
  if (offset + 4 > limit) return null;
  return {
    value: ((first & 0x7fff) << 16) | bytes.readUInt16LE(offset + 2),
    nextOffset: offset + 4,
  };
};

const parseStringPool = (manifest, offset, chunkSize) => {
  const headerSize = manifest.readUInt16LE(offset + 2);
  if (headerSize < 28 || headerSize > chunkSize) return null;
  const stringCount = manifest.readUInt32LE(offset + 8);
  const styleCount = manifest.readUInt32LE(offset + 12);
  const flags = manifest.readUInt32LE(offset + 16);
  const stringsStart = manifest.readUInt32LE(offset + 20);
  const stylesStart = manifest.readUInt32LE(offset + 24);
  const offsetsEnd = headerSize + (stringCount + styleCount) * 4;
  if (
    offsetsEnd > chunkSize ||
    stringsStart < offsetsEnd ||
    stringsStart >= chunkSize ||
    (stylesStart !== 0 &&
      (stylesStart < stringsStart || stylesStart > chunkSize))
  ) {
    return null;
  }
  const stringsLimit = offset + (stylesStart || chunkSize);
  const utf8 = (flags & UTF8_STRING_POOL_FLAG) !== 0;
  const strings = [];
  for (let index = 0; index < stringCount; index += 1) {
    const relative = manifest.readUInt32LE(offset + headerSize + index * 4);
    let cursor = offset + stringsStart + relative;
    if (cursor < offset + stringsStart || cursor >= stringsLimit) return null;
    if (utf8) {
      const utf16Length = readLength8(manifest, cursor, stringsLimit);
      if (!utf16Length) return null;
      const byteLength = readLength8(
        manifest,
        utf16Length.nextOffset,
        stringsLimit,
      );
      if (
        !byteLength ||
        byteLength.nextOffset + byteLength.value >= stringsLimit
      ) {
        return null;
      }
      const end = byteLength.nextOffset + byteLength.value;
      if (manifest[end] !== 0) return null;
      const value = manifest
        .subarray(byteLength.nextOffset, end)
        .toString('utf8');
      if (Buffer.byteLength(value, 'utf8') !== byteLength.value) return null;
      strings.push(value);
    } else {
      const length = readLength16(manifest, cursor, stringsLimit);
      if (!length) return null;
      cursor = length.nextOffset;
      const end = cursor + length.value * 2;
      if (end + 2 > stringsLimit || manifest.readUInt16LE(end) !== 0)
        return null;
      strings.push(manifest.subarray(cursor, end).toString('utf16le'));
    }
  }
  return strings;
};

const hasValidStringIndex = (index, strings, allowNone = false) =>
  (allowNone && index === APK_NO_STRING_INDEX) || index < strings.length;

const readStartElement = (
  manifest,
  offset,
  chunkHeaderSize,
  chunkSize,
  strings,
) => {
  if (
    chunkHeaderSize !== APK_XML_NODE_HEADER_SIZE ||
    chunkSize < APK_XML_NODE_HEADER_SIZE + APK_START_ELEMENT_EXT_SIZE
  ) {
    return null;
  }
  const extensionOffset = offset + chunkHeaderSize;
  const namespaceIndex = manifest.readUInt32LE(extensionOffset);
  const nameIndex = manifest.readUInt32LE(extensionOffset + 4);
  const attributeStart = manifest.readUInt16LE(extensionOffset + 8);
  const attributeSize = manifest.readUInt16LE(extensionOffset + 10);
  const attributeCount = manifest.readUInt16LE(extensionOffset + 12);
  const attributesOffset = extensionOffset + attributeStart;
  const attributesEnd = attributesOffset + attributeCount * attributeSize;
  if (
    !hasValidStringIndex(namespaceIndex, strings, true) ||
    !hasValidStringIndex(nameIndex, strings) ||
    attributeStart < APK_START_ELEMENT_EXT_SIZE ||
    attributeSize < APK_ATTRIBUTE_SIZE ||
    !Number.isSafeInteger(attributesEnd) ||
    attributesOffset > offset + chunkSize ||
    attributesEnd > offset + chunkSize
  ) {
    return null;
  }

  // This is an archive gate, not a full Android resource parser. It validates
  // every declared fixed attribute record and its string references, while
  // deliberately leaving resource-map and typed-value semantics to Android.
  const attributesValid = Array.from(
    { length: attributeCount },
    (_value, index) => attributesOffset + index * attributeSize,
  ).every((attributeOffset) => {
    if (attributeOffset + APK_ATTRIBUTE_SIZE > attributesEnd) return false;
    const attributeNamespace = manifest.readUInt32LE(attributeOffset);
    const attributeName = manifest.readUInt32LE(attributeOffset + 4);
    const rawValue = manifest.readUInt32LE(attributeOffset + 8);
    const typedValueSize = manifest.readUInt16LE(attributeOffset + 12);
    return (
      hasValidStringIndex(attributeNamespace, strings, true) &&
      hasValidStringIndex(attributeName, strings) &&
      hasValidStringIndex(rawValue, strings, true) &&
      typedValueSize >= 8 &&
      typedValueSize <= attributeSize - 12
    );
  });
  return attributesValid ? { namespaceIndex, nameIndex } : null;
};

const readEndElement = (
  manifest,
  offset,
  chunkHeaderSize,
  chunkSize,
  strings,
) => {
  if (
    chunkHeaderSize !== APK_XML_NODE_HEADER_SIZE ||
    chunkSize !== APK_XML_NODE_HEADER_SIZE + APK_END_ELEMENT_EXT_SIZE
  ) {
    return null;
  }
  const namespaceIndex = manifest.readUInt32LE(offset + chunkHeaderSize);
  const nameIndex = manifest.readUInt32LE(offset + chunkHeaderSize + 4);
  return hasValidStringIndex(namespaceIndex, strings, true) &&
    hasValidStringIndex(nameIndex, strings)
    ? { namespaceIndex, nameIndex }
    : null;
};

const isValidApkBinaryXml = (manifest) => {
  if (manifest.length < APK_XML_HEADER_SIZE) return false;
  const headerSize = manifest.readUInt16LE(2);
  const declaredSize = manifest.readUInt32LE(4);
  if (
    manifest.readUInt16LE(0) !== APK_XML_TYPE ||
    headerSize !== APK_XML_HEADER_SIZE ||
    declaredSize !== manifest.length
  ) {
    return false;
  }

  let strings = null;
  let stack = [];
  let rootCount = 0;
  let offset = headerSize;
  while (offset < declaredSize) {
    if (offset + 8 > declaredSize) return false;
    const type = manifest.readUInt16LE(offset);
    const chunkHeaderSize = manifest.readUInt16LE(offset + 2);
    const chunkSize = manifest.readUInt32LE(offset + 4);
    if (
      chunkHeaderSize < 8 ||
      chunkHeaderSize > chunkSize ||
      chunkSize > declaredSize - offset
    ) {
      return false;
    }
    if (type === APK_STRING_POOL_TYPE) {
      if (strings !== null || stack.length > 0 || rootCount > 0) return false;
      strings = parseStringPool(manifest, offset, chunkSize);
      if (!strings) return false;
    } else if (type === APK_START_ELEMENT_TYPE) {
      if (!strings) return false;
      const element = readStartElement(
        manifest,
        offset,
        chunkHeaderSize,
        chunkSize,
        strings,
      );
      if (!element || (stack.length === 0 && rootCount > 0)) return false;
      if (stack.length === 0) {
        if (strings[element.nameIndex] !== 'manifest') return false;
        rootCount += 1;
      }
      stack = [...stack, element];
    } else if (type === APK_END_ELEMENT_TYPE) {
      if (!strings || stack.length === 0) return false;
      const element = readEndElement(
        manifest,
        offset,
        chunkHeaderSize,
        chunkSize,
        strings,
      );
      const expected = stack.at(-1);
      if (
        !element ||
        element.namespaceIndex !== expected.namespaceIndex ||
        element.nameIndex !== expected.nameIndex
      ) {
        return false;
      }
      stack = stack.slice(0, -1);
    }
    offset += chunkSize;
  }
  return (
    offset === declaredSize &&
    strings !== null &&
    rootCount === 1 &&
    stack.length === 0
  );
};

const readProtoVarint = (bytes, state) => {
  let value = 0;
  let multiplier = 1;
  for (let count = 0; count < 10; count += 1) {
    if (state.offset >= state.end)
      throw new Error('Truncated protobuf varint.');
    const byte = bytes[state.offset++];
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value))
      throw new Error('Oversized protobuf varint.');
    if ((byte & 0x80) === 0) return value;
    multiplier *= 128;
  }
  throw new Error('Oversized protobuf varint.');
};

const parseProtoMessage = (bytes, start, end, limits, depth) => {
  if (depth > limits.maxProtobufDepth) {
    throw new Error('Protobuf nesting exceeds its resource limit.');
  }
  const fields = [];
  const state = { offset: start, end };
  while (state.offset < end) {
    if (fields.length >= limits.maxProtobufFields) {
      throw new Error('Protobuf field count exceeds its resource limit.');
    }
    const tag = readProtoVarint(bytes, state);
    const fieldNumber = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (fieldNumber < 1) throw new Error('Invalid protobuf field number.');
    if (wireType === 0) {
      readProtoVarint(bytes, state);
      fields.push({ fieldNumber, wireType });
    } else if (wireType === 1) {
      if (state.offset + 8 > end) throw new Error('Truncated fixed64 field.');
      state.offset += 8;
      fields.push({ fieldNumber, wireType });
    } else if (wireType === 2) {
      const length = readProtoVarint(bytes, state);
      if (length > end - state.offset)
        throw new Error('Truncated protobuf bytes.');
      const valueStart = state.offset;
      state.offset += length;
      fields.push({
        fieldNumber,
        wireType,
        start: valueStart,
        end: state.offset,
      });
    } else if (wireType === 5) {
      if (state.offset + 4 > end) throw new Error('Truncated fixed32 field.');
      state.offset += 4;
      fields.push({ fieldNumber, wireType });
    } else {
      throw new Error('Unsupported protobuf wire type.');
    }
  }
  if (state.offset !== end) throw new Error('Invalid protobuf bounds.');
  return fields;
};

const isValidAabManifest = (manifest, limits) => {
  try {
    const rootFields = parseProtoMessage(
      manifest,
      0,
      manifest.length,
      limits,
      0,
    );
    const finalNodeCase = rootFields.reduce((currentCase, field) => {
      if (field.wireType !== 2) return currentCase;
      if (field.fieldNumber === 1) return { case: 'element', field };
      if (field.fieldNumber === 2) return { case: 'text', field };
      return currentCase;
    }, null);
    if (finalNodeCase?.case !== 'element') return false;
    const elementFields = parseProtoMessage(
      manifest,
      finalNodeCase.field.start,
      finalNodeCase.field.end,
      limits,
      1,
    );
    const finalName = elementFields.reduce(
      (name, field) =>
        field.fieldNumber === 3 && field.wireType === 2 ? field : name,
      null,
    );
    return (
      finalName !== null &&
      manifest.subarray(finalName.start, finalName.end).toString('utf8') ===
        'manifest'
    );
  } catch {
    return false;
  }
};

const requireAndroidArchive = async (bytes, extension, limitOverrides) => {
  const manifestEntry =
    extension === '.apk'
      ? 'AndroidManifest.xml'
      : 'base/manifest/AndroidManifest.xml';
  const invalidArchive = () =>
    new Error(
      `Android package must be a valid ZIP containing ${manifestEntry}.`,
    );

  try {
    const limits = resolveArchiveLimits(limitOverrides);
    if (bytes.length > limits.maxPackageBytes) throw invalidArchive();
    const zipFile = await fromBuffer(bytes, {
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    const entry = await findEntry(zipFile, manifestEntry);
    if (!entry || entry.isEncrypted()) throw invalidArchive();
    if (
      entry.compressedSize > limits.maxManifestCompressedBytes ||
      entry.uncompressedSize > limits.maxManifestUncompressedBytes ||
      entry.uncompressedSize / Math.max(1, entry.compressedSize) >
        limits.maxManifestCompressionRatio
    ) {
      throw invalidArchive();
    }
    requireMatchingLocalMetadata(bytes, entry);
    const manifest = await readEntryBytes(
      zipFile,
      entry,
      Math.min(
        limits.maxManifestStreamBytes,
        limits.maxManifestUncompressedBytes,
      ),
    );
    if (
      manifest.length === 0 ||
      manifest.length !== entry.uncompressedSize ||
      crc32(manifest) !== entry.crc32 ||
      (extension === '.apk' && !isValidApkBinaryXml(manifest)) ||
      (extension === '.aab' && !isValidAabManifest(manifest, limits))
    ) {
      throw invalidArchive();
    }
  } catch {
    throw invalidArchive();
  }
};

export const packageAndroid = async (input, dependencies = {}) => {
  const execute = dependencies.execute ?? defaultExecute;
  const isPathIgnored = dependencies.isPathIgnored ?? defaultIsPathIgnored;
  const statPath = dependencies.statPath ?? stat;
  const readFilePath = dependencies.readFilePath ?? readFile;
  const realpathPath = dependencies.realpathPath ?? realpath;
  const readArtifactPath = dependencies.readArtifactPath ?? readFile;
  const platform = dependencies.platform ?? process.platform;
  const renamePath = dependencies.renamePath ?? rename;
  const removePath = dependencies.removePath ?? rm;
  const createBackupName = dependencies.createBackupName ?? randomUUID;
  const configPath = resolve(input.configPath);
  const resourcesDirectory = await requireResourceDirectory(
    input.resourcesDirectories.map((directory) => resolve(directory)),
    statPath,
  );
  await requireFile(
    configPath,
    'MERCHANT_TERMINAL_SIGNING_CONFIG must reference an ignored HBuilderX pack config.',
    'Unable to read signing config.',
    statPath,
  );
  if (!(await isPathIgnored(configPath))) {
    throw new Error('The signing config must be ignored by Git.');
  }
  const packConfig = await readPackConfig(configPath, readFilePath);
  const configuredProject = resolve(dirname(configPath), packConfig.project);
  const [canonicalProject, canonicalResources] = await Promise.all([
    canonicalPath(configuredProject, realpathPath),
    canonicalPath(resourcesDirectory, realpathPath),
  ]);
  if (!equalCanonicalPaths(canonicalProject, canonicalResources, platform)) {
    throw new Error(
      'HBuilderX pack config project must match the verified App Android resources.',
    );
  }
  const outputPath = resolve(input.outputPath);
  const outputExtension = extname(outputPath).toLowerCase();
  if (!['.apk', '.aab'].includes(outputExtension)) {
    throw new Error('Android package output must end in .apk or .aab.');
  }

  const version = await execute(input.cliPath, ['ver']);
  if (!/\d+\.\d+/u.test(version)) {
    throw new Error('Unable to determine the HBuilderX CLI version.');
  }

  const userInfo = await execute(input.cliPath, ['user', 'info']);
  const userInfoLines = userInfo
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const identityRecords = userInfoLines.filter(
    (line) => !/^0\s*:\s*user\s+info\s*:\s*OK\s*$/iu.test(line),
  );
  const hasUnsafeStatus = userInfoLines.some(
    (line) =>
      /not\s+logged\s+in|未登录|\b(?:warning|error|failed|failure)\b/iu.test(
        line,
      ) ||
      (/^\d+\s*:/u.test(line) &&
        !/^0\s*:\s*user\s+info\s*:\s*OK\s*$/iu.test(line)),
  );
  const hasClearIdentity =
    identityRecords.length === 1 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(identityRecords[0]);
  if (hasUnsafeStatus || !hasClearIdentity) {
    throw new Error('HBuilderX CLI is not logged in.');
  }

  let backupPath;
  try {
    backupPath = await reservePreviousArtifact(
      outputPath,
      statPath,
      renamePath,
      createBackupName,
    );
  } catch (error) {
    if (
      error?.message ===
      'Configured Android package output must be a regular file.'
    ) {
      throw error;
    }
    throw new Error('Unable to check configured Android package output.');
  }

  try {
    await execute(input.cliPath, ['pack', '--config', configPath]);
    const limits = resolveArchiveLimits(input.archiveLimits);
    let artifactStat;
    try {
      artifactStat = await statPath(outputPath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error(
          'HBuilderX pack completed without producing the configured APK/AAB.',
        );
      }
      throw safePackageError(
        'POST_PACK_STAT',
        'Unable to inspect packaged Android artifact.',
      );
    }
    if (!artifactStat.isFile()) {
      throw new Error(
        'Configured Android package output must be a regular file.',
      );
    }
    if (artifactStat.size > limits.maxPackageBytes) {
      throw new Error(
        `Android package must be a valid ZIP containing ${
          outputExtension === '.apk'
            ? 'AndroidManifest.xml'
            : 'base/manifest/AndroidManifest.xml'
        }.`,
      );
    }
    let bytes;
    try {
      bytes = await readArtifactPath(outputPath);
    } catch {
      throw safePackageError(
        'POST_PACK_READ',
        'Unable to read packaged Android artifact.',
      );
    }
    await requireAndroidArchive(bytes, outputExtension, limits);
    let sha256;
    try {
      sha256 = createHash('sha256').update(bytes).digest('hex');
    } catch {
      throw safePackageError(
        'POST_PACK_HASH',
        'Unable to hash packaged Android artifact.',
      );
    }
    if (backupPath) {
      try {
        await removePath(backupPath);
      } catch {
        throw safePackageError(
          'POST_PACK_FINALIZE',
          'Unable to finalize packaged Android artifact.',
        );
      }
    }
    return Object.freeze({ outputPath, sha256 });
  } catch (error) {
    try {
      await restorePreviousArtifact(
        outputPath,
        backupPath,
        removePath,
        renamePath,
      );
    } catch {
      throw new Error(
        'Android package failed and the previous artifact could not be restored.',
      );
    }
    if (error instanceof SafeAndroidPackageError) throw error;
    throw error;
  }
};

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const configPath = process.env.MERCHANT_TERMINAL_SIGNING_CONFIG;
  const outputPath = process.env.MERCHANT_TERMINAL_DEBUG_APK;
  if (!configPath || !outputPath) {
    throw new Error(
      'MERCHANT_TERMINAL_SIGNING_CONFIG and MERCHANT_TERMINAL_DEBUG_APK are required.',
    );
  }

  const result = await packageAndroid({
    cliPath: process.env.HBUILDERX_CLI || 'cli',
    configPath,
    outputPath,
    resourcesDirectories: [
      resolve('dist/build/app-android'),
      resolve('dist/build/app'),
    ],
  });
  console.log(`Android package: ${result.outputPath}`);
  console.log(`SHA-256: ${result.sha256}`);
}
