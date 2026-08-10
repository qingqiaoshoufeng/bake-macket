import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { executeHBuilderX, packageAndroid } from './package-android.mjs';

const execFileAsync = promisify(execFile);

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

const createMinimalZip = (entryName, contents, method = 8) => {
  const name = Buffer.from(entryName);
  const data = Buffer.from(contents);
  const compressed = method === 8 ? deflateRawSync(data) : data;
  const checksum = crc32(data);
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(method, 8);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(name.length, 26);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(method, 10);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(data.length, 24);
  centralHeader.writeUInt16LE(name.length, 28);

  const centralDirectory = Buffer.concat([centralHeader, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localHeader.length + name.length + compressed.length, 16);

  return Buffer.concat([localHeader, name, compressed, centralDirectory, end]);
};

const encodeUtf8StringPoolValue = (value) => {
  const bytes = Buffer.from(value, 'utf8');
  if (value.length > 0x7f || bytes.length > 0x7f) {
    throw new Error('Test string pool helper only supports short UTF-8 values');
  }
  return Buffer.concat([
    Buffer.from([value.length, bytes.length]),
    bytes,
    Buffer.from([0]),
  ]);
};

const binaryAndroidManifest = ({ rootName = 'manifest' } = {}) => {
  const values = [
    'manifest',
    rootName === 'manifest' ? 'application' : rootName,
  ];
  const stringData = Buffer.concat(values.map(encodeUtf8StringPoolValue));
  const stringOffsets = Buffer.alloc(values.length * 4);
  let stringOffset = 0;
  values.forEach((value, index) => {
    stringOffsets.writeUInt32LE(stringOffset, index * 4);
    stringOffset += encodeUtf8StringPoolValue(value).length;
  });
  const stringPoolSize =
    28 + stringOffsets.length + stringData.length + (-stringData.length & 3);
  const stringPool = Buffer.alloc(stringPoolSize);
  stringPool.writeUInt16LE(0x0001, 0);
  stringPool.writeUInt16LE(28, 2);
  stringPool.writeUInt32LE(stringPool.length, 4);
  stringPool.writeUInt32LE(values.length, 8);
  stringPool.writeUInt32LE(0, 12);
  stringPool.writeUInt32LE(0x00000100, 16);
  stringPool.writeUInt32LE(28 + stringOffsets.length, 20);
  stringPool.writeUInt32LE(0, 24);
  stringOffsets.copy(stringPool, 28);
  stringData.copy(stringPool, 28 + stringOffsets.length);

  const nameIndex = rootName === 'manifest' ? 0 : 1;
  const startElement = Buffer.alloc(36);
  startElement.writeUInt16LE(0x0102, 0);
  startElement.writeUInt16LE(16, 2);
  startElement.writeUInt32LE(startElement.length, 4);
  startElement.writeUInt32LE(1, 8);
  startElement.writeUInt32LE(0xffffffff, 12);
  startElement.writeUInt32LE(0xffffffff, 16);
  startElement.writeUInt32LE(nameIndex, 20);
  startElement.writeUInt16LE(20, 24);
  startElement.writeUInt16LE(20, 26);

  const endElement = Buffer.alloc(24);
  endElement.writeUInt16LE(0x0103, 0);
  endElement.writeUInt16LE(16, 2);
  endElement.writeUInt32LE(endElement.length, 4);
  endElement.writeUInt32LE(2, 8);
  endElement.writeUInt32LE(0xffffffff, 12);
  endElement.writeUInt32LE(0xffffffff, 16);
  endElement.writeUInt32LE(nameIndex, 20);

  const manifest = Buffer.concat([
    Buffer.alloc(8),
    stringPool,
    startElement,
    endElement,
  ]);
  manifest.writeUInt16LE(0x0003, 0);
  manifest.writeUInt16LE(8, 2);
  manifest.writeUInt32LE(manifest.length, 4);
  return manifest;
};

const apkBytes = (options) =>
  createMinimalZip('AndroidManifest.xml', binaryAndroidManifest(options));

const encodeProtoField = (fieldNumber, wireType, value) => {
  const tag = Buffer.from([(fieldNumber << 3) | wireType]);
  if (wireType === 2)
    return Buffer.concat([tag, Buffer.from([value.length]), value]);
  throw new Error('Unsupported test protobuf wire type');
};

const bundleManifest = (rootName = 'manifest') => {
  const element = encodeProtoField(3, 2, Buffer.from(rootName));
  return encodeProtoField(1, 2, element);
};

const aabBytes = (manifest = bundleManifest()) =>
  createMinimalZip('base/manifest/AndroidManifest.xml', manifest);
const withoutLocalEntry = (zip) => {
  const centralOffset = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const centralOnly = Buffer.from(zip.subarray(centralOffset));
  const endOffset = centralOnly.indexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  centralOnly.writeUInt32LE(0, endOffset + 16);
  return centralOnly;
};

const createFixture = async ({ gitState = 'ignored' } = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'bake-terminal-package-'));
  const resourcesDirectory = join(root, 'dist', 'build', 'app');
  const apkPath = join(root, 'output', 'merchant-terminal-debug.apk');
  const configPath = join(root, 'pack.config.json');
  await mkdir(resourcesDirectory, { recursive: true });
  await mkdir(join(root, 'output'), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify({
      project: resourcesDirectory,
      platform: 'android',
      iscustom: false,
      safemode: true,
    }),
  );
  await execFileAsync('git', ['init', '--quiet'], { cwd: root });
  if (gitState !== 'unignored') {
    await writeFile(join(root, '.gitignore'), 'pack.config.json\n');
  }
  if (gitState === 'tracked') {
    await execFileAsync('git', ['add', '-f', 'pack.config.json'], {
      cwd: root,
    });
  }

  return { root, resourcesDirectory, apkPath, configPath };
};

test('sets finite operation-specific HBuilderX timeouts', async () => {
  const calls = [];
  const exec = async (_command, _arguments, options) => {
    calls.push(options);
    return { stdout: 'ok', stderr: '' };
  };

  await executeHBuilderX('cli', ['ver'], exec);
  await executeHBuilderX('cli', ['user', 'info'], exec);
  await executeHBuilderX('cli', ['pack', '--config', 'secret.json'], exec);

  assert.equal(calls.length, 3);
  assert.ok(calls[0].timeout > 0 && calls[0].timeout <= 60_000);
  assert.equal(calls[1].timeout, calls[0].timeout);
  assert.ok(calls[2].timeout > calls[0].timeout);
  assert.ok(calls[2].timeout <= 30 * 60_000);
});

test('redacts HBuilderX timeout and nonzero command errors', async () => {
  for (const error of [
    Object.assign(new Error('secret failure'), {
      code: 'ETIMEDOUT',
      killed: true,
      stdout: 'secret stdout',
      stderr: 'secret stderr',
    }),
    Object.assign(new Error('secret failure'), {
      code: 7,
      stdout: 'secret stdout',
      stderr: 'secret stderr',
    }),
  ]) {
    await assert.rejects(
      executeHBuilderX(
        'C:/secret/cli.exe',
        ['pack', '--config', 'C:/secret/signing.json'],
        async () => Promise.reject(error),
      ),
      (failure) =>
        /HBuilderX pack (timed out|failed)/u.test(failure.message) &&
        !/secret|signing\.json|stdout|stderr/u.test(failure.message),
    );
  }
});

test('rejects a signing config that is not ignored by Git', async () => {
  const fixture = await createFixture({ gitState: 'unignored' });
  let packCalled = false;

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
      },
      {
        execute: async (_command, arguments_) => {
          if (arguments_[0] === 'pack') {
            packCalled = true;
            await writeFile(fixture.apkPath, apkBytes());
          }
          return arguments_[0] === 'ver'
            ? '4.75.2026031801'
            : 'user@example.com';
        },
      },
    ),
    /signing config must be ignored by Git/i,
  );
  assert.equal(packCalled, false);
});

test('continues with an ignored signing config', async () => {
  const fixture = await createFixture();

  const result = await packageAndroid(
    {
      cliPath: 'cli',
      configPath: fixture.configPath,
      resourcesDirectories: [fixture.resourcesDirectory],
      outputPath: fixture.apkPath,
    },
    {
      execute: async (_command, arguments_) => {
        if (arguments_[0] === 'pack') {
          await writeFile(fixture.apkPath, apkBytes());
          return 'pack complete';
        }
        return arguments_[0] === 'ver' ? '4.75.2026031801' : 'user@example.com';
      },
    },
  );

  assert.equal(result.outputPath, fixture.apkPath);
});

test('rejects a tracked signing config even when it matches an ignore rule', async () => {
  const fixture = await createFixture({ gitState: 'tracked' });
  let packCalled = false;

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
      },
      {
        execute: async (_command, arguments_) => {
          if (arguments_[0] === 'pack') packCalled = true;
          return arguments_[0] === 'ver'
            ? '4.75.2026031801'
            : 'user@example.com';
        },
      },
    ),
    /signing config must be ignored by Git/i,
  );
  assert.equal(packCalled, false);
});

test('checks HBuilderX before packaging and requires a real APK output', async () => {
  const fixture = await createFixture();
  const calls = [];
  const execute = async (command, arguments_) => {
    calls.push([command, arguments_]);
    if (arguments_[0] === 'pack') {
      await writeFile(fixture.apkPath, apkBytes());
      return 'pack complete';
    }
    return arguments_[0] === 'ver' ? '4.75.2026031801' : 'user@example.com';
  };

  const result = await packageAndroid(
    {
      cliPath: 'C:/HBuilderX/cli.exe',
      configPath: fixture.configPath,
      resourcesDirectories: [fixture.resourcesDirectory],
      outputPath: fixture.apkPath,
    },
    { execute },
  );

  assert.deepEqual(calls, [
    ['C:/HBuilderX/cli.exe', ['ver']],
    ['C:/HBuilderX/cli.exe', ['user', 'info']],
    ['C:/HBuilderX/cli.exe', ['pack', '--config', fixture.configPath]],
  ]);
  assert.equal(result.outputPath, fixture.apkPath);
  assert.match(result.sha256, /^[0-9a-f]{64}$/u);
});

test('accepts a deterministic same-byte artifact recreated by this pack run', async () => {
  const fixture = await createFixture();
  const deterministicBytes = apkBytes();
  await writeFile(fixture.apkPath, deterministicBytes);

  const result = await packageAndroid(
    {
      cliPath: 'cli',
      configPath: fixture.configPath,
      resourcesDirectories: [fixture.resourcesDirectory],
      outputPath: fixture.apkPath,
    },
    {
      execute: async (_command, arguments_) => {
        if (arguments_[0] === 'pack') {
          await assert.rejects(stat(fixture.apkPath), { code: 'ENOENT' });
          await writeFile(fixture.apkPath, deterministicBytes);
          return 'pack complete';
        }
        return arguments_[0] === 'ver' ? '4.75.2026031801' : 'user@example.com';
      },
    },
  );

  assert.equal(
    result.sha256,
    createHash('sha256').update(deterministicBytes).digest('hex'),
  );
});

test('restores the previous artifact when pack does not recreate the output', async () => {
  const fixture = await createFixture();
  const previousBytes = Buffer.from('stale-apk-bytes');
  await writeFile(fixture.apkPath, previousBytes);

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
      },
      {
        execute: async (_command, arguments_) =>
          arguments_[0] === 'ver' ? '4.75.2026031801' : 'user@example.com',
      },
    ),
    /pack completed without producing the configured APK\/AAB/,
  );
  assert.deepEqual(await readFile(fixture.apkPath), previousBytes);
  assert.deepEqual((await readdir(join(fixture.root, 'output'))).sort(), [
    'merchant-terminal-debug.apk',
  ]);
});

test('restores the previous artifact when the pack command fails', async () => {
  const fixture = await createFixture();
  const previousBytes = Buffer.from('previous-after-pack-failure');
  await writeFile(fixture.apkPath, previousBytes);

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
      },
      {
        execute: async (_command, arguments_) => {
          if (arguments_[0] === 'pack') throw new Error('pack failed');
          return arguments_[0] === 'ver'
            ? '4.75.2026031801'
            : 'user@example.com';
        },
      },
    ),
    /pack failed/,
  );
  assert.deepEqual(await readFile(fixture.apkPath), previousBytes);
  assert.deepEqual(await readdir(join(fixture.root, 'output')), [
    'merchant-terminal-debug.apk',
  ]);
});

test('restores the previous artifact when ZIP validation fails', async () => {
  const fixture = await createFixture();
  const previousBytes = Buffer.from('known-good-previous-artifact');
  await writeFile(fixture.apkPath, previousBytes);

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
      },
      {
        execute: async (_command, arguments_) => {
          if (arguments_[0] === 'pack') {
            await writeFile(
              fixture.apkPath,
              Buffer.from('invalid-new-artifact'),
            );
          }
          return arguments_[0] === 'ver'
            ? '4.75.2026031801'
            : 'user@example.com';
        },
      },
    ),
    /valid ZIP.*AndroidManifest\.xml/i,
  );
  assert.deepEqual(await readFile(fixture.apkPath), previousBytes);
  assert.deepEqual(await readdir(join(fixture.root, 'output')), [
    'merchant-terminal-debug.apk',
  ]);
});

test('deletes the unique backup only after successful package validation', async () => {
  const fixture = await createFixture();
  await writeFile(fixture.apkPath, 'previous-artifact');

  await packageAndroid(
    {
      cliPath: 'cli',
      configPath: fixture.configPath,
      resourcesDirectories: [fixture.resourcesDirectory],
      outputPath: fixture.apkPath,
    },
    {
      execute: async (_command, arguments_) => {
        if (arguments_[0] === 'pack')
          await writeFile(fixture.apkPath, apkBytes());
        return arguments_[0] === 'ver' ? '4.75.2026031801' : 'user@example.com';
      },
    },
  );

  assert.deepEqual(await readFile(fixture.apkPath), apkBytes());
  assert.deepEqual(await readdir(join(fixture.root, 'output')), [
    'merchant-terminal-debug.apk',
  ]);
});

test('redacts post-pack stat failures and restores the previous artifact', async () => {
  const fixture = await createFixture();
  const previousBytes = Buffer.from('previous-before-stat-failure');
  const secret = `TOP_SECRET:${fixture.apkPath}`;
  let outputStats = 0;
  await writeFile(fixture.apkPath, previousBytes);

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
      },
      {
        statPath: async (filePath) => {
          if (filePath === fixture.apkPath) {
            outputStats += 1;
            if (outputStats >= 2) throw new Error(secret);
          }
          return stat(filePath);
        },
        execute: async (_command, arguments_) => {
          if (arguments_[0] === 'pack') {
            await writeFile(fixture.apkPath, apkBytes());
          }
          return arguments_[0] === 'ver'
            ? '4.75.2026031801'
            : 'user@example.com';
        },
      },
    ),
    (error) => {
      const visible = `${error}\n${JSON.stringify(error)}`;
      return (
        error.message === 'Unable to inspect packaged Android artifact.' &&
        !visible.includes('TOP_SECRET') &&
        !visible.includes(fixture.apkPath)
      );
    },
  );
  assert.deepEqual(await readFile(fixture.apkPath), previousBytes);
});

test('redacts post-pack read failures and restores the previous artifact', async () => {
  const fixture = await createFixture();
  const previousBytes = Buffer.from('previous-before-read-failure');
  const secret = `TOP_SECRET:${fixture.apkPath}`;
  await writeFile(fixture.apkPath, previousBytes);

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
      },
      {
        readArtifactPath: async () => {
          throw new Error(secret);
        },
        execute: async (_command, arguments_) => {
          if (arguments_[0] === 'pack') {
            await writeFile(fixture.apkPath, apkBytes());
          }
          return arguments_[0] === 'ver'
            ? '4.75.2026031801'
            : 'user@example.com';
        },
      },
    ),
    (error) => {
      const visible = `${error}\n${JSON.stringify(error)}`;
      return (
        error.message === 'Unable to read packaged Android artifact.' &&
        !visible.includes('TOP_SECRET') &&
        !visible.includes(fixture.apkPath)
      );
    },
  );
  assert.deepEqual(await readFile(fixture.apkPath), previousBytes);
});

test('fails closed and restores the previous artifact when backup deletion fails', async () => {
  const fixture = await createFixture();
  const previousBytes = Buffer.from('previous-before-backup-delete-failure');
  const secret = `TOP_SECRET:${fixture.apkPath}`;
  await writeFile(fixture.apkPath, previousBytes);

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
      },
      {
        removePath: async (filePath, options) => {
          if (filePath.includes('.backup-')) throw new Error(secret);
          return rm(filePath, options);
        },
        execute: async (_command, arguments_) => {
          if (arguments_[0] === 'pack') {
            await writeFile(fixture.apkPath, apkBytes());
          }
          return arguments_[0] === 'ver'
            ? '4.75.2026031801'
            : 'user@example.com';
        },
      },
    ),
    (error) => {
      const visible = `${error}\n${JSON.stringify(error)}`;
      return (
        error.message === 'Unable to finalize packaged Android artifact.' &&
        !visible.includes('TOP_SECRET') &&
        !visible.includes(fixture.apkPath)
      );
    },
  );
  assert.deepEqual(await readFile(fixture.apkPath), previousBytes);
  assert.deepEqual(await readdir(join(fixture.root, 'output')), [
    'merchant-terminal-debug.apk',
  ]);
});

test('rejects an output directory without renaming or removing it', async () => {
  const fixture = await createFixture();
  await mkdir(fixture.apkPath);
  let packCalled = false;

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
      },
      {
        execute: async (_command, arguments_) => {
          if (arguments_[0] === 'pack') packCalled = true;
          return arguments_[0] === 'ver'
            ? '4.75.2026031801'
            : 'user@example.com';
        },
      },
    ),
    /output must be a regular file/i,
  );
  assert.equal(packCalled, false);
  assert.equal((await stat(fixture.apkPath)).isDirectory(), true);
});

test('requires a ZIP artifact with the platform manifest entry', async () => {
  for (const { extension, bytes, message } of [
    {
      extension: '.apk',
      bytes: Buffer.alloc(0),
      message: /valid ZIP.*AndroidManifest\.xml/i,
    },
    {
      extension: '.apk',
      bytes: Buffer.from('random text'),
      message: /valid ZIP.*AndroidManifest\.xml/i,
    },
    {
      extension: '.apk',
      bytes: apkBytes().subarray(0, apkBytes().length - 8),
      message: /valid ZIP.*AndroidManifest\.xml/i,
    },
    {
      extension: '.apk',
      bytes: withoutLocalEntry(apkBytes()),
      message: /valid ZIP.*AndroidManifest\.xml/i,
    },
    {
      extension: '.apk',
      bytes: createMinimalZip('classes.dex', Buffer.from('dex')),
      message: /AndroidManifest\.xml/i,
    },
    {
      extension: '.aab',
      bytes: createMinimalZip('AndroidManifest.xml', binaryAndroidManifest()),
      message: /base\/manifest\/AndroidManifest\.xml/i,
    },
  ]) {
    const fixture = await createFixture();
    const outputPath = fixture.apkPath.replace(/\.apk$/u, extension);
    await assert.rejects(
      packageAndroid(
        {
          cliPath: 'cli',
          configPath: fixture.configPath,
          resourcesDirectories: [fixture.resourcesDirectory],
          outputPath,
        },
        {
          execute: async (_command, arguments_) => {
            if (arguments_[0] === 'pack') await writeFile(outputPath, bytes);
            return arguments_[0] === 'ver'
              ? '4.75.2026031801'
              : 'user@example.com';
          },
        },
      ),
      message,
    );
  }
});

test('rejects manifest data corruption and central/local metadata conflicts', async () => {
  const mutations = [
    (zip) => {
      const damaged = Buffer.from(zip);
      damaged[30 + Buffer.byteLength('AndroidManifest.xml')] ^= 0xff;
      return damaged;
    },
    (zip) => {
      const damaged = Buffer.from(zip);
      const central = damaged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      damaged.writeUInt32LE(
        (damaged.readUInt32LE(central + 16) ^ 1) >>> 0,
        central + 16,
      );
      return damaged;
    },
    (zip) => {
      const damaged = Buffer.from(zip);
      const central = damaged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      damaged.writeUInt32LE(
        damaged.readUInt32LE(central + 20) + 1,
        central + 20,
      );
      return damaged;
    },
    (zip) => {
      const damaged = Buffer.from(zip);
      const central = damaged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      damaged.writeUInt16LE(0, central + 10);
      return damaged;
    },
    (zip) => {
      const damaged = Buffer.from(zip);
      const central = damaged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      damaged.writeUInt16LE(1, central + 8);
      return damaged;
    },
  ];

  for (const mutate of mutations) {
    const fixture = await createFixture();
    await assert.rejects(
      packageAndroid(
        {
          cliPath: 'cli',
          configPath: fixture.configPath,
          resourcesDirectories: [fixture.resourcesDirectory],
          outputPath: fixture.apkPath,
        },
        {
          execute: async (_command, arguments_) => {
            if (arguments_[0] === 'pack') {
              await writeFile(fixture.apkPath, mutate(apkBytes()));
            }
            return arguments_[0] === 'ver'
              ? '4.75.2026031801'
              : 'user@example.com';
          },
        },
      ),
      /valid ZIP.*AndroidManifest\.xml/i,
    );
  }
});

test('rejects empty and malformed APK binary XML manifests', async () => {
  for (const manifest of [
    Buffer.alloc(0),
    Buffer.from('manifest'),
    Buffer.from([0x03, 0x00, 0x08, 0x00, 0xff, 0xff, 0xff, 0x7f]),
  ]) {
    const fixture = await createFixture();
    await assert.rejects(
      packageAndroid(
        {
          cliPath: 'cli',
          configPath: fixture.configPath,
          resourcesDirectories: [fixture.resourcesDirectory],
          outputPath: fixture.apkPath,
        },
        {
          execute: async (_command, arguments_) => {
            if (arguments_[0] === 'pack') {
              await writeFile(
                fixture.apkPath,
                createMinimalZip('AndroidManifest.xml', manifest),
              );
            }
            return arguments_[0] === 'ver'
              ? '4.75.2026031801'
              : 'user@example.com';
          },
        },
      ),
      /valid ZIP.*AndroidManifest\.xml/i,
    );
  }
});

test('requires a complete APK binary XML string pool and manifest root element', async () => {
  const valid = binaryAndroidManifest();
  const stringPoolSize = valid.readUInt32LE(12);
  const startElementOffset = 8 + stringPoolSize;
  const headerOnly = Buffer.alloc(8);
  headerOnly.writeUInt16LE(0x0003, 0);
  headerOnly.writeUInt16LE(8, 2);
  headerOnly.writeUInt32LE(8, 4);
  const invalidStringIndex = Buffer.from(valid);
  invalidStringIndex.writeUInt32LE(99, startElementOffset + 20);
  const outOfBoundsChunk = Buffer.from(valid);
  outOfBoundsChunk.writeUInt32LE(valid.length + 1, 12);
  const truncatedStartElement = Buffer.from(
    valid.subarray(0, valid.length - 1),
  );
  truncatedStartElement.writeUInt32LE(truncatedStartElement.length, 4);

  for (const manifest of [
    headerOnly,
    valid.subarray(0, startElementOffset),
    outOfBoundsChunk,
    truncatedStartElement,
    invalidStringIndex,
    binaryAndroidManifest({ rootName: 'application' }),
  ]) {
    const fixture = await createFixture();
    await assert.rejects(
      packageAndroid(
        {
          cliPath: 'cli',
          configPath: fixture.configPath,
          resourcesDirectories: [fixture.resourcesDirectory],
          outputPath: fixture.apkPath,
        },
        {
          execute: async (_command, arguments_) => {
            if (arguments_[0] === 'pack') {
              await writeFile(
                fixture.apkPath,
                createMinimalZip('AndroidManifest.xml', manifest),
              );
            }
            return arguments_[0] === 'ver'
              ? '4.75.2026031801'
              : 'user@example.com';
          },
        },
      ),
      /valid ZIP.*AndroidManifest\.xml/i,
    );
  }
});

test('rejects malformed APK element boundaries and incomplete element trees', async () => {
  const valid = binaryAndroidManifest();
  const stringPoolSize = valid.readUInt32LE(12);
  const startOffset = 8 + stringPoolSize;
  const endOffset = startOffset + valid.readUInt32LE(startOffset + 4);
  const mutate = (update) => {
    const manifest = Buffer.from(valid);
    update(manifest, { startOffset, endOffset });
    return manifest;
  };
  const appendRoot = Buffer.concat([
    valid,
    valid.subarray(startOffset, valid.length),
  ]);
  appendRoot.writeUInt32LE(appendRoot.length, 4);

  const invalidManifests = [
    mutate((manifest, offsets) => {
      manifest.writeUInt16LE(15, offsets.startOffset + 2);
    }),
    mutate((manifest, offsets) => {
      manifest.writeUInt16LE(19, offsets.startOffset + 24);
    }),
    mutate((manifest, offsets) => {
      manifest.writeUInt16LE(19, offsets.startOffset + 26);
      manifest.writeUInt16LE(1, offsets.startOffset + 28);
    }),
    mutate((manifest, offsets) => {
      manifest.writeUInt16LE(1, offsets.startOffset + 28);
    }),
    mutate((manifest, offsets) => {
      manifest.writeUInt16LE(1, offsets.startOffset + 28);
      manifest.writeUInt32LE(55, offsets.startOffset + 4);
    }),
    (() => {
      const missingEnd = Buffer.from(valid.subarray(0, endOffset));
      missingEnd.writeUInt32LE(missingEnd.length, 4);
      return missingEnd;
    })(),
    mutate((manifest, offsets) => {
      manifest.writeUInt32LE(1, offsets.endOffset + 20);
    }),
    mutate((manifest, offsets) => {
      manifest.writeUInt32LE(0, offsets.endOffset + 16);
    }),
    appendRoot,
  ];

  for (const manifest of invalidManifests) {
    const fixture = await createFixture();
    await assert.rejects(
      packageAndroid(
        {
          cliPath: 'cli',
          configPath: fixture.configPath,
          resourcesDirectories: [fixture.resourcesDirectory],
          outputPath: fixture.apkPath,
        },
        {
          execute: async (_command, arguments_) => {
            if (arguments_[0] === 'pack') {
              await writeFile(
                fixture.apkPath,
                createMinimalZip('AndroidManifest.xml', manifest),
              );
            }
            return arguments_[0] === 'ver'
              ? '4.75.2026031801'
              : 'user@example.com';
          },
        },
      ),
      /valid ZIP.*AndroidManifest\.xml/i,
    );
  }
});

test('validates the AAB manifest protobuf root instead of accepting arbitrary bytes', async () => {
  for (const manifest of [
    Buffer.from([0x0a, 0x01, 0x00]),
    Buffer.from([0x12, 0x02, 0x12]),
    Buffer.from([0x12, 0x02, 0x0f, 0x00]),
    bundleManifest('application'),
  ]) {
    const fixture = await createFixture();
    const outputPath = fixture.apkPath.replace(/\.apk$/u, '.aab');
    await assert.rejects(
      packageAndroid(
        {
          cliPath: 'cli',
          configPath: fixture.configPath,
          resourcesDirectories: [fixture.resourcesDirectory],
          outputPath,
        },
        {
          execute: async (_command, arguments_) => {
            if (arguments_[0] === 'pack') {
              await writeFile(outputPath, aabBytes(manifest));
            }
            return arguments_[0] === 'ver'
              ? '4.75.2026031801'
              : 'user@example.com';
          },
        },
      ),
      /valid ZIP.*base\/manifest\/AndroidManifest\.xml/i,
    );
  }
});

test('applies protobuf last-one-wins semantics to AAB XmlNode and element name', async () => {
  const manifestElement = encodeProtoField(
    1,
    2,
    encodeProtoField(3, 2, Buffer.from('manifest')),
  );
  const applicationElement = encodeProtoField(
    1,
    2,
    encodeProtoField(3, 2, Buffer.from('application')),
  );
  const textNode = encodeProtoField(2, 2, Buffer.from('text'));
  const cases = [
    {
      manifest: Buffer.concat([manifestElement, textNode]),
      accepted: false,
    },
    {
      manifest: Buffer.concat([textNode, manifestElement]),
      accepted: true,
    },
    {
      manifest: encodeProtoField(
        1,
        2,
        Buffer.concat([
          encodeProtoField(3, 2, Buffer.from('manifest')),
          encodeProtoField(3, 2, Buffer.from('application')),
        ]),
      ),
      accepted: false,
    },
    {
      manifest: encodeProtoField(
        1,
        2,
        Buffer.concat([
          encodeProtoField(3, 2, Buffer.from('application')),
          encodeProtoField(3, 2, Buffer.from('manifest')),
        ]),
      ),
      accepted: true,
    },
    {
      manifest: Buffer.concat([applicationElement, manifestElement]),
      accepted: true,
    },
  ];

  for (const { manifest, accepted } of cases) {
    const fixture = await createFixture();
    const outputPath = fixture.apkPath.replace(/\.apk$/u, '.aab');
    const operation = packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath,
      },
      {
        execute: async (_command, arguments_) => {
          if (arguments_[0] === 'pack') {
            await writeFile(outputPath, aabBytes(manifest));
          }
          return arguments_[0] === 'ver'
            ? '4.75.2026031801'
            : 'user@example.com';
        },
      },
    );
    if (accepted) {
      assert.equal((await operation).outputPath, outputPath);
    } else {
      await assert.rejects(
        operation,
        /valid ZIP.*base\/manifest\/AndroidManifest\.xml/i,
      );
    }
  }
});

test('enforces injected package, manifest, ratio, and streaming resource limits', async () => {
  const validApk = apkBytes();
  const limits = [
    { maxPackageBytes: validApk.length - 1 },
    { maxManifestCompressedBytes: 1 },
    { maxManifestUncompressedBytes: 8 },
    { maxManifestCompressionRatio: 1 },
    { maxManifestStreamBytes: 8 },
  ];

  for (const archiveLimits of limits) {
    const fixture = await createFixture();
    await assert.rejects(
      packageAndroid(
        {
          cliPath: 'cli',
          configPath: fixture.configPath,
          resourcesDirectories: [fixture.resourcesDirectory],
          outputPath: fixture.apkPath,
          archiveLimits,
        },
        {
          execute: async (_command, arguments_) => {
            if (arguments_[0] === 'pack') {
              await writeFile(fixture.apkPath, validApk);
            }
            return arguments_[0] === 'ver'
              ? '4.75.2026031801'
              : 'user@example.com';
          },
        },
      ),
      /valid ZIP.*AndroidManifest\.xml/i,
    );
  }
});

test('rejects an oversized package from stat before reading its bytes', async () => {
  const fixture = await createFixture();
  const validApk = apkBytes();
  let outputRead = false;

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
        archiveLimits: { maxPackageBytes: validApk.length },
      },
      {
        statPath: async (filePath) => {
          const value = await stat(filePath);
          return filePath === fixture.apkPath
            ? { isFile: () => true, size: validApk.length + 1 }
            : value;
        },
        readArtifactPath: async (filePath) => {
          outputRead = true;
          return readFile(filePath);
        },
        execute: async (_command, arguments_) => {
          if (arguments_[0] === 'pack') {
            await writeFile(fixture.apkPath, validApk);
          }
          return arguments_[0] === 'ver'
            ? '4.75.2026031801'
            : 'user@example.com';
        },
      },
    ),
    /valid ZIP.*AndroidManifest\.xml/i,
  );
  assert.equal(outputRead, false);
});

test('accepts an AAB ZIP containing a bounded manifest protobuf root', async () => {
  const fixture = await createFixture();
  const outputPath = fixture.apkPath.replace(/\.apk$/u, '.aab');

  const result = await packageAndroid(
    {
      cliPath: 'cli',
      configPath: fixture.configPath,
      resourcesDirectories: [fixture.resourcesDirectory],
      outputPath,
    },
    {
      execute: async (_command, arguments_) => {
        if (arguments_[0] === 'pack') await writeFile(outputPath, aabBytes());
        return arguments_[0] === 'ver' ? '4.75.2026031801' : 'user@example.com';
      },
    },
  );

  assert.equal(result.outputPath, outputPath);
});

test('rejects user info output containing only CLI status lines', async () => {
  const fixture = await createFixture();

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
      },
      {
        execute: async (_command, arguments_) =>
          arguments_[0] === 'ver'
            ? '4.75.2026031801'
            : '0:user info:OK\n1:USER INFO : completed',
      },
    ),
    /HBuilderX CLI is not logged in/,
  );
});

test('accepts one clear identity line plus the documented OK status', async () => {
  const fixture = await createFixture();

  const result = await packageAndroid(
    {
      cliPath: 'cli',
      configPath: fixture.configPath,
      resourcesDirectories: [fixture.resourcesDirectory],
      outputPath: fixture.apkPath,
    },
    {
      execute: async (_command, arguments_) => {
        if (arguments_[0] === 'pack')
          await writeFile(fixture.apkPath, apkBytes());
        return arguments_[0] === 'ver'
          ? '4.75.2026031801'
          : 'user@example.com\n0:user info:OK';
      },
    },
  );

  assert.equal(result.outputPath, fixture.apkPath);
});

test('rejects negative, warning, error, or ambiguous user info', async () => {
  for (const userInfo of [
    'Not logged in',
    '未登录',
    'warning: cached identity\nuser@example.com\n0:user info:OK',
    'error: authentication expired\nuser@example.com',
    'user@example.com\nanother@example.com\n0:user info:OK',
    'logged in',
  ]) {
    const fixture = await createFixture();
    let packCalled = false;
    await assert.rejects(
      packageAndroid(
        {
          cliPath: 'cli',
          configPath: fixture.configPath,
          resourcesDirectories: [fixture.resourcesDirectory],
          outputPath: fixture.apkPath,
        },
        {
          execute: async (_command, arguments_) => {
            if (arguments_[0] === 'pack') packCalled = true;
            return arguments_[0] === 'ver' ? '4.75.2026031801' : userInfo;
          },
        },
      ),
      /HBuilderX CLI is not logged in/,
    );
    assert.equal(packCalled, false);
  }
});

test('rejects numeric user info status output before calling pack', async () => {
  const fixture = await createFixture();
  let packCalled = false;

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
      },
      {
        execute: async (_command, arguments_) => {
          if (arguments_[0] === 'pack') packCalled = true;
          return arguments_[0] === 'ver'
            ? '4.75.2026031801'
            : '\n  0:user info:OK  \n\n';
        },
      },
    ),
    /HBuilderX CLI is not logged in/,
  );
  assert.equal(packCalled, false);
});

test('resolves a relative config project from the config directory', async () => {
  const fixture = await createFixture();
  await writeFile(
    fixture.configPath,
    JSON.stringify({
      project: 'dist/build/app',
      platform: 'android',
      iscustom: false,
      safemode: true,
    }),
  );

  const result = await packageAndroid(
    {
      cliPath: 'cli',
      configPath: fixture.configPath,
      resourcesDirectories: [fixture.resourcesDirectory],
      outputPath: fixture.apkPath,
    },
    {
      execute: async (_command, arguments_) => {
        if (arguments_[0] === 'pack')
          await writeFile(fixture.apkPath, apkBytes());
        return arguments_[0] === 'ver' ? '4.75.2026031801' : 'user@example.com';
      },
    },
  );

  assert.equal(result.outputPath, fixture.apkPath);
});

test('rejects a config project that is not the verified resource directory', async () => {
  const fixture = await createFixture();
  const otherProject = join(fixture.root, 'other-project');
  await mkdir(otherProject);
  await writeFile(
    fixture.configPath,
    JSON.stringify({
      project: otherProject,
      platform: 'android',
      iscustom: false,
      safemode: true,
    }),
  );
  let cliCalled = false;

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
      },
      { execute: async () => (cliCalled = true) },
    ),
    /pack config project must match the verified App Android resources/i,
  );
  assert.equal(cliCalled, false);
});

test('reports resource stat errors other than ENOENT without leaking details', async () => {
  const fixture = await createFixture();
  const secret = 'private-resource-location';
  const accessError = Object.assign(new Error(secret), { code: 'EACCES' });

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
      },
      {
        statPath: async (filePath) => {
          if (filePath === fixture.resourcesDirectory) throw accessError;
          return stat(filePath);
        },
      },
    ),
    (error) =>
      /Unable to check App Android resources/u.test(error.message) &&
      !error.message.includes(secret),
  );
});

test('reports config and artifact stat errors other than ENOENT without leaking details', async () => {
  const fixture = await createFixture();
  const secret = 'private-file-location';
  const accessError = Object.assign(new Error(secret), { code: 'EACCES' });

  for (const deniedPath of [fixture.configPath, fixture.apkPath]) {
    await assert.rejects(
      packageAndroid(
        {
          cliPath: 'cli',
          configPath: fixture.configPath,
          resourcesDirectories: [fixture.resourcesDirectory],
          outputPath: fixture.apkPath,
        },
        {
          statPath: async (filePath) => {
            if (filePath === deniedPath) throw accessError;
            return stat(filePath);
          },
          execute: async (_command, arguments_) =>
            arguments_[0] === 'ver' ? '4.75.2026031801' : 'user@example.com',
        },
      ),
      (error) =>
        /Unable to (?:read signing config|check configured Android package output)/u.test(
          error.message,
        ) && !error.message.includes(secret),
    );
  }
});

test('rejects an App resource path that is a regular file', async () => {
  const fixture = await createFixture();
  const resourceFile = join(fixture.root, 'app-resources');
  await writeFile(resourceFile, 'not-a-directory');

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [resourceFile],
        outputPath: fixture.apkPath,
      },
      { execute: async () => 'ok' },
    ),
    /Missing App Android resources/,
  );
});

test('requires safe mode so HBuilderX returns a local package', async () => {
  const fixture = await createFixture();
  await writeFile(
    fixture.configPath,
    JSON.stringify({
      project: fixture.root,
      platform: 'android',
      iscustom: false,
      safemode: false,
    }),
  );

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
      },
      { execute: async () => 'ok' },
    ),
    /safemode=true/,
  );
});

test('never accepts an App resource directory as a packaged artifact', async () => {
  const fixture = await createFixture();
  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.resourcesDirectory,
      },
      { execute: async () => 'ok' },
    ),
    /must end in .apk or .aab/,
  );
});

test('redacts malformed pack config input and parser details', async () => {
  const fixture = await createFixture();
  const secret = 'TOP_SECRET';
  await writeFile(fixture.configPath, `{"password":"${secret}",`);

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
      },
      { isPathIgnored: async () => true },
    ),
    (error) => {
      const visible = `${error}\n${JSON.stringify(error)}`;
      return (
        /Invalid HBuilderX pack config JSON/u.test(error.message) &&
        !visible.includes(secret) &&
        !visible.includes(fixture.configPath)
      );
    },
  );
});

test('classifies pack config read failures without leaking path or details', async () => {
  const fixture = await createFixture();
  const secret = 'TOP_SECRET';

  for (const { code, message } of [
    { code: 'ENOENT', message: /HBuilderX pack config no longer exists/u },
    { code: 'EACCES', message: /Unable to read HBuilderX pack config/u },
  ]) {
    await assert.rejects(
      packageAndroid(
        {
          cliPath: 'cli',
          configPath: fixture.configPath,
          resourcesDirectories: [fixture.resourcesDirectory],
          outputPath: fixture.apkPath,
        },
        {
          isPathIgnored: async () => true,
          readFilePath: async () => {
            throw Object.assign(new Error(`${secret}:${fixture.configPath}`), {
              code,
            });
          },
        },
      ),
      (error) => {
        const visible = `${error}\n${JSON.stringify(error)}`;
        return (
          message.test(error.message) &&
          !visible.includes(secret) &&
          !visible.includes(fixture.configPath)
        );
      },
    );
  }
});

test('compares real resource paths with Windows case semantics', async () => {
  const fixture = await createFixture();
  const calls = [];

  const result = await packageAndroid(
    {
      cliPath: 'cli',
      configPath: fixture.configPath,
      resourcesDirectories: [fixture.resourcesDirectory],
      outputPath: fixture.apkPath,
    },
    {
      platform: 'win32',
      realpathPath: async (candidate) => {
        calls.push(candidate);
        return candidate === fixture.resourcesDirectory
          ? 'C:\\BUILD\\APP'
          : 'c:\\build\\app';
      },
      execute: async (_command, arguments_) => {
        if (arguments_[0] === 'pack')
          await writeFile(fixture.apkPath, apkBytes());
        return arguments_[0] === 'ver' ? '4.75.2026031801' : 'user@example.com';
      },
    },
  );

  assert.equal(result.outputPath, fixture.apkPath);
  assert.equal(calls.length, 2);
});

test('rejects distinct canonical projects and redacts realpath failures', async () => {
  const fixture = await createFixture();
  await writeFile(
    fixture.configPath,
    JSON.stringify({
      project: join(fixture.root, 'different-project'),
      platform: 'android',
      iscustom: false,
      safemode: true,
    }),
  );

  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
      },
      {
        platform: 'linux',
        realpathPath: async (candidate) =>
          candidate === fixture.resourcesDirectory
            ? '/build/app'
            : '/BUILD/app',
      },
    ),
    /pack config project must match/u,
  );

  const secret = 'TOP_SECRET';
  await assert.rejects(
    packageAndroid(
      {
        cliPath: 'cli',
        configPath: fixture.configPath,
        resourcesDirectories: [fixture.resourcesDirectory],
        outputPath: fixture.apkPath,
      },
      {
        realpathPath: async () => {
          throw Object.assign(new Error(secret), { code: 'EACCES' });
        },
      },
    ),
    (error) =>
      /Unable to resolve App Android resource paths/u.test(error.message) &&
      !`${error}\n${JSON.stringify(error)}`.includes(secret),
  );
});
