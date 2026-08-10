import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as verifyAndroidModule from './verify-android.mjs';

const {
  buildWindowsCommandLine,
  clearAndroidLogs,
  openDiagnosticSmoke,
  resolveApkAnalyzerCommand,
  runAdbCommand,
  runApkAnalyzerCommand,
  requireExpectedCapture,
  requireSmokeResult,
  requireTruncatedCapture,
  verifyAndroidInstallation: verifyAndroidInstallationImplementation,
  waitForSmokeResult,
  waitForNonEmptyCapture,
} = verifyAndroidModule;

const packageName = 'com.bakemall.merchantterminal';
const expectedAnalyzerResult = Object.freeze({
  status: 0,
  stdout: `${packageName}\n`,
  stderr: '',
  signal: null,
});
const verifyAndroidInstallation = (candidatePath, dependencies = {}) =>
  verifyAndroidInstallationImplementation(candidatePath, {
    runApkAnalyzer: async () => expectedAnalyzerResult,
    ...dependencies,
  });

const createApkFixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'bake-terminal-verify-'));
  const apkPath = join(root, 'merchant-terminal-debug.apk');
  await writeFile(apkPath, 'apk-bytes');
  return { root, apkPath };
};

test('default adb runner preserves structured success stderr and process metadata', () => {
  let options;
  const result = runAdbCommand(
    ['version'],
    (_command, _arguments, callOptions) => {
      options = callOptions;
      return {
        status: 0,
        stdout: Buffer.from('Android Debug Bridge'),
        stderr: Buffer.from('warning'),
        error: undefined,
        signal: null,
      };
    },
  );

  assert.deepEqual(result, {
    status: 0,
    stdout: 'Android Debug Bridge',
    stderr: 'warning',
    error: undefined,
    signal: null,
  });
  assert.ok(options.timeout > 0 && options.timeout <= 15_000);
});

test('selects apkanalyzer.bat by default on Windows', () => {
  assert.equal(resolveApkAnalyzerCommand('win32', {}), 'apkanalyzer.bat');
  assert.equal(resolveApkAnalyzerCommand('linux', {}), 'apkanalyzer');
  assert.equal(
    resolveApkAnalyzerCommand('win32', {
      MERCHANT_TERMINAL_APKANALYZER: 'C:\\Android SDK\\apkanalyzer.cmd',
    }),
    'C:\\Android SDK\\apkanalyzer.cmd',
  );
});

test('builds one auditable Windows command line for spaces and fails closed on metacharacters', () => {
  assert.equal(
    buildWindowsCommandLine([
      'C:\\Android SDK\\apkanalyzer.bat',
      'manifest',
      'application-id',
      'C:\\build output\\candidate.apk',
    ]),
    '""C:\\Android SDK\\apkanalyzer.bat" "manifest" "application-id" "C:\\build output\\candidate.apk""',
  );
  for (const unsafe of [
    'path&name',
    'path^name',
    'path%name',
    'path!name',
    'path(name)',
    'path"name',
    'line\nbreak',
    'line\rbreak',
    `nul${String.fromCharCode(0)}byte`,
  ]) {
    assert.throws(
      () => buildWindowsCommandLine(['apkanalyzer.bat', unsafe]),
      /unsafe Windows command argument/i,
    );
  }
});

test('default APK analyzer runner supports Windows batch launch with a finite timeout', () => {
  let invocation;
  const result = runApkAnalyzerCommand(
    ['manifest', 'application-id', 'C:\\build output\\candidate.apk'],
    (_command, _arguments, options) => {
      invocation = { command: _command, arguments: _arguments, options };
      return {
        status: 0,
        stdout: Buffer.from(`${packageName}\n`),
        stderr: Buffer.alloc(0),
        error: undefined,
        signal: null,
      };
    },
    {
      platform: 'win32',
      command: 'C:\\Android SDK\\apkanalyzer.bat',
      comSpec: 'C:\\Windows\\System32\\cmd.exe',
    },
  );

  assert.equal(invocation.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(invocation.arguments.slice(0, 4), [
    '/d',
    '/v:off',
    '/s',
    '/c',
  ]);
  assert.equal(invocation.arguments.length, 5);
  assert.equal(
    invocation.arguments[4],
    '""C:\\Android SDK\\apkanalyzer.bat" "manifest" "application-id" "C:\\build output\\candidate.apk""',
  );
  assert.ok(
    invocation.options.timeout > 0 && invocation.options.timeout <= 15_000,
  );
  assert.deepEqual(result, { ...expectedAnalyzerResult, error: undefined });
});

test('reports a clear error when the configured APK path is missing', async () => {
  const calls = [];

  await assert.rejects(
    verifyAndroidInstallation(null, {
      runAdb: (arguments_) => calls.push(arguments_),
    }),
    /regular \.apk file/,
  );
  assert.deepEqual(calls, []);
});

test('requires the configured APK path to be a regular .apk file before adb', async () => {
  assert.equal(typeof verifyAndroidInstallation, 'function');
  const fixture = await createApkFixture();
  const directoryPath = join(fixture.root, 'not-an-apk.apk');
  await mkdir(directoryPath);
  const calls = [];

  await assert.rejects(
    verifyAndroidInstallation(directoryPath, {
      runAdb: (arguments_) => calls.push(arguments_),
    }),
    /regular \.apk file/,
  );
  assert.deepEqual(calls, []);
});

test('rejects a regular file whose extension is not .apk before adb', async () => {
  const fixture = await createApkFixture();
  const nonApkPath = join(fixture.root, 'merchant-terminal-debug.zip');
  await writeFile(nonApkPath, 'not-an-apk');
  const calls = [];

  await assert.rejects(
    verifyAndroidInstallation(nonApkPath, {
      runAdb: (arguments_) => calls.push(arguments_),
    }),
    /regular \.apk file/,
  );
  assert.deepEqual(calls, []);
});

test('verifies the APK application ID before any adb mutation', async () => {
  const fixture = await createApkFixture();
  const analyzerCalls = [];
  const adbCalls = [];
  let packagePathChecks = 0;

  await verifyAndroidInstallation(fixture.apkPath, {
    runApkAnalyzer: async (arguments_, options) => {
      analyzerCalls.push([arguments_, options]);
      return {
        status: 0,
        stdout: `${packageName}\n`,
        stderr: '',
        signal: null,
      };
    },
    runAdb: (arguments_) => {
      adbCalls.push(arguments_);
      if (arguments_[0] === 'uninstall' || arguments_[0] === 'install') {
        return 'Success';
      }
      packagePathChecks += 1;
      return packagePathChecks === 1
        ? { status: 1, stdout: '', stderr: '' }
        : `package:/data/app/${packageName}/base.apk`;
    },
  });

  assert.deepEqual(analyzerCalls[0][0], [
    'manifest',
    'application-id',
    fixture.apkPath,
  ]);
  assert.ok(analyzerCalls[0][1].timeout > 0);
  assert.equal(adbCalls[0][0], 'uninstall');
});

test('rejects a wrong APK application ID before uninstall or install', async () => {
  const fixture = await createApkFixture();
  const adbCalls = [];

  await assert.rejects(
    verifyAndroidInstallation(fixture.apkPath, {
      runApkAnalyzer: async () => ({
        status: 0,
        stdout: 'com.example.impostor\n',
        stderr: '',
        signal: null,
      }),
      runAdb: (arguments_) => adbCalls.push(arguments_),
    }),
    /APK application ID does not match the merchant terminal/u,
  );
  assert.deepEqual(adbCalls, []);
});

test('classifies APK analyzer timeout and failure without leaking details or touching adb', async () => {
  const fixture = await createApkFixture();

  for (const result of [
    {
      status: null,
      stdout: 'TOP_SECRET',
      stderr: fixture.apkPath,
      signal: 'SIGTERM',
      error: Object.assign(new Error('TOP_SECRET'), { code: 'ETIMEDOUT' }),
    },
    {
      status: 7,
      stdout: 'TOP_SECRET',
      stderr: fixture.apkPath,
      signal: null,
      error: undefined,
    },
  ]) {
    const adbCalls = [];
    await assert.rejects(
      verifyAndroidInstallation(fixture.apkPath, {
        runApkAnalyzer: async () => result,
        runAdb: (arguments_) => adbCalls.push(arguments_),
      }),
      (error) =>
        /APK identity verification (?:timed out|failed)/u.test(error.message) &&
        !`${error}\n${JSON.stringify(error)}`.includes('TOP_SECRET') &&
        !`${error}\n${JSON.stringify(error)}`.includes(fixture.apkPath),
    );
    assert.deepEqual(adbCalls, []);
  }
});

test('uninstalls the fixed package, installs the APK, and confirms its package path', async () => {
  assert.equal(typeof verifyAndroidInstallation, 'function');
  const fixture = await createApkFixture();
  const calls = [];
  let packagePathChecks = 0;
  const runAdb = (arguments_) => {
    calls.push(arguments_);
    if (arguments_[0] === 'uninstall') return 'Success';
    if (arguments_[0] === 'install') return 'Success';
    packagePathChecks += 1;
    return packagePathChecks === 1
      ? { status: 1, stdout: '', stderr: '' }
      : `package:/data/app/${packageName}/base.apk`;
  };

  await verifyAndroidInstallation(fixture.apkPath, { runAdb });

  assert.deepEqual(calls, [
    ['uninstall', packageName],
    ['shell', 'pm', 'path', packageName],
    ['install', '-r', fixture.apkPath],
    ['shell', 'pm', 'path', packageName],
  ]);
});

test('accepts explicit Unknown package and not installed uninstall results only after confirming absence', async () => {
  const fixture = await createApkFixture();

  for (const output of [
    `Unknown package: ${packageName}`,
    `Failure [${packageName} is not installed for 0]`,
  ]) {
    const calls = [];
    let packagePathChecks = 0;
    const runAdb = (arguments_) => {
      calls.push(arguments_);
      if (arguments_[0] === 'uninstall') {
        const error = new Error('uninstall failed');
        error.stderr = output;
        throw error;
      }
      if (arguments_[0] === 'install') return 'Success';
      packagePathChecks += 1;
      return packagePathChecks === 1
        ? `Unknown package: ${packageName}`
        : `package:/data/app/${packageName}/base.apk`;
    };

    await verifyAndroidInstallation(fixture.apkPath, { runAdb });

    assert.deepEqual(calls, [
      ['uninstall', packageName],
      ['shell', 'pm', 'path', packageName],
      ['install', '-r', fixture.apkPath],
      ['shell', 'pm', 'path', packageName],
    ]);
  }
});

test('rejects a successful uninstall result when the old package remains, before a false-positive install', async () => {
  const fixture = await createApkFixture();
  const calls = [];
  const runAdb = (arguments_) => {
    calls.push(arguments_);
    if (arguments_[0] === 'uninstall') return 'Success';
    if (arguments_[0] === 'install')
      return 'Failure [INSTALL_FAILED_INVALID_APK]';
    return `package:/data/app/${packageName}/base.apk`;
  };

  await assert.rejects(
    verifyAndroidInstallation(fixture.apkPath, { runAdb }),
    /old fixed package remains installed/,
  );
  assert.deepEqual(calls, [
    ['uninstall', packageName],
    ['shell', 'pm', 'path', packageName],
  ]);
});

test('rejects install output containing Failure even when it also reports Success', async () => {
  const fixture = await createApkFixture();
  const calls = [];
  const runAdb = (arguments_) => {
    calls.push(arguments_);
    if (arguments_[0] === 'uninstall') return 'Success';
    if (arguments_[0] === 'install') {
      return 'Failure [INSTALL_FAILED_INVALID_APK]\nSuccess';
    }
    return calls.filter(([command]) => command === 'shell').length === 1
      ? { status: 1, stdout: '', stderr: '' }
      : `package:/data/app/${packageName}/base.apk`;
  };

  await assert.rejects(
    verifyAndroidInstallation(fixture.apkPath, { runAdb }),
    /adb install failed/,
  );
  assert.deepEqual(calls, [
    ['uninstall', packageName],
    ['shell', 'pm', 'path', packageName],
    ['install', '-r', fixture.apkPath],
  ]);
});

test('rejects install output containing more than one Success result', async () => {
  const fixture = await createApkFixture();
  const runAdb = (arguments_) => {
    if (arguments_[0] === 'uninstall') return 'Success';
    if (arguments_[0] === 'install') return 'Success\nSuccess';
    return { status: 1, stdout: '', stderr: '' };
  };

  await assert.rejects(
    verifyAndroidInstallation(fixture.apkPath, { runAdb }),
    /adb install failed/,
  );
});

test('rejects status zero install when stderr reports Failure', async () => {
  const fixture = await createApkFixture();
  let packagePathChecks = 0;
  const runAdb = (arguments_) => {
    if (arguments_[0] === 'uninstall') {
      return { status: 0, stdout: 'Success', stderr: '' };
    }
    if (arguments_[0] === 'install') {
      return { status: 0, stdout: 'Success', stderr: 'Failure [secret]' };
    }
    packagePathChecks += 1;
    return { status: 1, stdout: '', stderr: '' };
  };

  await assert.rejects(
    verifyAndroidInstallation(fixture.apkPath, { runAdb }),
    (error) =>
      /adb install failed/u.test(error.message) &&
      !/secret/u.test(error.message),
  );
  assert.equal(packagePathChecks, 1);
});

test('accepts an explicit not-installed result from the package absence check', async () => {
  const fixture = await createApkFixture();
  let packagePathChecks = 0;
  const runAdb = (arguments_) => {
    if (arguments_[0] === 'uninstall' || arguments_[0] === 'install') {
      return 'Success';
    }
    packagePathChecks += 1;
    return packagePathChecks === 1
      ? `Failure [${packageName} is not installed for 0]`
      : `package:/data/app/${packageName}/base.apk`;
  };

  await verifyAndroidInstallation(fixture.apkPath, { runAdb });
  assert.equal(packagePathChecks, 2);
});

test('accepts pm path status 1 with empty output as a missing package', async () => {
  const fixture = await createApkFixture();
  let packagePathChecks = 0;
  const runAdb = (arguments_) => {
    if (arguments_[0] === 'uninstall' || arguments_[0] === 'install') {
      return { status: 0, stdout: 'Success', stderr: '' };
    }
    packagePathChecks += 1;
    return packagePathChecks === 1
      ? { status: 1, stdout: '', stderr: '' }
      : {
          status: 0,
          stdout: `package:/data/app/${packageName}/base.apk`,
          stderr: '',
        };
  };

  await verifyAndroidInstallation(fixture.apkPath, { runAdb });
  assert.equal(packagePathChecks, 2);
});

test('does not treat a status-less empty pm path exception as package absence', async () => {
  const fixture = await createApkFixture();
  const runAdb = (arguments_) => {
    if (arguments_[0] === 'uninstall') return 'Success';
    throw new Error();
  };

  await assert.rejects(
    verifyAndroidInstallation(fixture.apkPath, { runAdb }),
    /adb operation pm path failed/,
  );
});

test('rejects an ambiguous uninstall failure when the old fixed package remains', async () => {
  const fixture = await createApkFixture();
  const calls = [];
  const runAdb = (arguments_) => {
    calls.push(arguments_);
    if (arguments_[0] === 'uninstall') {
      const error = new Error('uninstall failed');
      error.stdout = 'Failure [DELETE_FAILED_INTERNAL_ERROR]';
      throw error;
    }
    return `package:/data/app/${packageName}/base.apk`;
  };

  await assert.rejects(
    verifyAndroidInstallation(fixture.apkPath, { runAdb }),
    /Failed to uninstall com\.bakemall\.merchantterminal/,
  );
  assert.deepEqual(calls, [
    ['uninstall', packageName],
    ['shell', 'pm', 'path', packageName],
  ]);
});

test('rejects an unrecognized successful uninstall result', async () => {
  const fixture = await createApkFixture();
  const calls = [];
  const runAdb = (arguments_) => {
    calls.push(arguments_);
    if (arguments_[0] === 'uninstall') {
      return { status: 0, stdout: 'unexpected output', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: '' };
  };

  await assert.rejects(
    verifyAndroidInstallation(fixture.apkPath, { runAdb }),
    /Failed to uninstall com\.bakemall\.merchantterminal/,
  );
  assert.deepEqual(calls, [
    ['uninstall', packageName],
    ['shell', 'pm', 'path', packageName],
  ]);
});

test('rejects uninstall errors other than a missing fixed package', async () => {
  assert.equal(typeof verifyAndroidInstallation, 'function');
  const fixture = await createApkFixture();
  const runAdb = (arguments_) => {
    if (arguments_[0] !== 'uninstall') return 'Success';
    const error = new Error('adb transport failed');
    error.stderr = 'error: device offline';
    throw error;
  };

  await assert.rejects(
    verifyAndroidInstallation(fixture.apkPath, { runAdb }),
    /Failed to uninstall com\.bakemall\.merchantterminal/,
  );
});

test('rejects installation when the fixed package is absent afterward', async () => {
  assert.equal(typeof verifyAndroidInstallation, 'function');
  const fixture = await createApkFixture();
  const runAdb = (arguments_) => {
    if (arguments_[0] === 'uninstall' || arguments_[0] === 'install') {
      return 'Success';
    }
    return { status: 1, stdout: '', stderr: '' };
  };

  await assert.rejects(
    verifyAndroidInstallation(fixture.apkPath, { runAdb }),
    /Installed APK does not provide com\.bakemall\.merchantterminal/,
  );
});

test('passes a finite timeout to every installation adb operation', async () => {
  const fixture = await createApkFixture();
  const options = [];
  let packagePathChecks = 0;
  const runAdb = (arguments_, callOptions) => {
    options.push(callOptions);
    if (arguments_[0] === 'uninstall' || arguments_[0] === 'install') {
      return { status: 0, stdout: 'Success', stderr: '' };
    }
    packagePathChecks += 1;
    return packagePathChecks === 1
      ? { status: 1, stdout: '', stderr: '' }
      : {
          status: 0,
          stdout: `package:/data/app/${packageName}/base.apk`,
          stderr: '',
        };
  };

  await verifyAndroidInstallation(fixture.apkPath, { runAdb });

  assert.equal(options.length, 4);
  assert.ok(options.every(({ timeout }) => timeout > 0 && timeout <= 15_000));
});

test('classifies uninstall timeout without leaking output', async () => {
  const fixture = await createApkFixture();
  let packageChecks = 0;
  const runAdb = (arguments_) => {
    if (arguments_[0] === 'uninstall') {
      return {
        status: null,
        stdout: 'sensitive',
        stderr: 'private',
        error: Object.assign(new Error('secret'), { code: 'ETIMEDOUT' }),
        signal: 'SIGTERM',
      };
    }
    packageChecks += 1;
    return { status: 1, stdout: '', stderr: '' };
  };

  await assert.rejects(
    verifyAndroidInstallation(fixture.apkPath, { runAdb }),
    (error) =>
      /adb operation uninstall timed out/u.test(error.message) &&
      !/sensitive|private|secret/u.test(error.message),
  );
  assert.equal(packageChecks, 0);
});

test('classifies uninstall startup failure without leaking output', async () => {
  const fixture = await createApkFixture();
  let packageChecks = 0;
  const runAdb = (arguments_) => {
    if (arguments_[0] === 'uninstall') {
      return {
        status: null,
        stdout: 'sensitive',
        stderr: 'private',
        error: Object.assign(new Error('secret'), { code: 'ENOENT' }),
        signal: null,
      };
    }
    packageChecks += 1;
    return { status: 1, stdout: '', stderr: '' };
  };

  await assert.rejects(
    verifyAndroidInstallation(fixture.apkPath, { runAdb }),
    (error) =>
      /adb operation uninstall failed/u.test(error.message) &&
      !/sensitive|private|secret/u.test(error.message),
  );
  assert.equal(packageChecks, 0);
});

test('classifies install timeout without leaking output or claiming missing Success', async () => {
  const fixture = await createApkFixture();
  let packagePathChecks = 0;
  const runAdb = (arguments_) => {
    if (arguments_[0] === 'uninstall') return 'Success';
    if (arguments_[0] === 'install') {
      return {
        status: null,
        stdout: 'Success sensitive',
        stderr: 'private',
        error: Object.assign(new Error('secret'), { code: 'ETIMEDOUT' }),
        signal: 'SIGTERM',
      };
    }
    packagePathChecks += 1;
    return { status: 1, stdout: '', stderr: '' };
  };

  await assert.rejects(
    verifyAndroidInstallation(fixture.apkPath, { runAdb }),
    (error) =>
      /adb operation install timed out/u.test(error.message) &&
      !/Success|sensitive|private|secret/u.test(error.message),
  );
  assert.equal(packagePathChecks, 1);
});

test('classifies pm path timeout instead of package absence', async () => {
  const fixture = await createApkFixture();
  const runAdb = (arguments_) => {
    if (arguments_[0] === 'uninstall') return 'Success';
    return {
      status: 1,
      stdout: '',
      stderr: 'private',
      error: Object.assign(new Error('secret'), { code: 'ETIMEDOUT' }),
      signal: 'SIGTERM',
    };
  };

  await assert.rejects(
    verifyAndroidInstallation(fixture.apkPath, { runAdb }),
    (error) =>
      /adb operation pm path timed out/u.test(error.message) &&
      !/private|secret/u.test(error.message),
  );
});

test('classifies PID and logcat timeout without leaking output', async () => {
  const timeoutResult = {
    status: null,
    stdout: '4242 sensitive',
    stderr: 'private',
    error: Object.assign(new Error('secret'), { code: 'ETIMEDOUT' }),
    signal: 'SIGTERM',
  };
  await assert.rejects(
    waitForSmokeResult('SUCCESS', 50, { runAdb: () => timeoutResult }),
    (error) =>
      /adb operation pidof timed out/u.test(error.message) &&
      !/4242|sensitive|private|secret/u.test(error.message),
  );

  let calls = 0;
  await assert.rejects(
    waitForSmokeResult('SUCCESS', 50, {
      runAdb: () => {
        calls += 1;
        return calls === 1
          ? { status: 0, stdout: '4242', stderr: '' }
          : timeoutResult;
      },
    }),
    (error) =>
      /adb operation logcat timed out/u.test(error.message) &&
      !/sensitive|private|secret/u.test(error.message),
  );
});

test('classifies log clearing timeout without leaking output', () => {
  assert.throws(
    () =>
      clearAndroidLogs({
        runAdb: () => ({
          status: null,
          stdout: 'sensitive',
          stderr: 'private',
          error: Object.assign(new Error('secret'), { code: 'ETIMEDOUT' }),
          signal: 'SIGTERM',
        }),
      }),
    (error) =>
      /adb operation logcat -c timed out/u.test(error.message) &&
      !/sensitive|private|secret/u.test(error.message),
  );
});

test('fails closed when clearing logcat fails', () => {
  assert.throws(
    () =>
      clearAndroidLogs({
        runAdb: () => ({ status: 1, stdout: '', stderr: 'denied' }),
      }),
    /logcat -c/u,
  );
});

test('reports a timed out diagnostics launch after the async runner settles', async () => {
  let settled = false;
  const timeoutError = Object.assign(new Error('sensitive timeout'), {
    code: 'ETIMEDOUT',
    killed: true,
    stdout: 'sensitive stdout',
    stderr: 'sensitive stderr',
  });

  await assert.rejects(
    openDiagnosticSmoke(9100, {
      runAdbAsync: async (_arguments, options) => {
        assert.equal(options.timeout, 15_000);
        await new Promise((resolve) => setImmediate(resolve));
        settled = true;
        throw timeoutError;
      },
    }),
    (error) =>
      settled &&
      /adb operation am start -W timed out/u.test(error.message) &&
      /stdout bytes 16; stderr bytes 16/u.test(error.message) &&
      !/sensitive/u.test(error.message),
  );
});

test('reports a signaled diagnostics exit with redacted byte counts', async () => {
  await assert.rejects(
    openDiagnosticSmoke(9100, {
      runAdbAsync: async () => ({
        status: null,
        signal: 'SIGKILL',
        stdout: 'sensitive output',
        stderr: 'private error',
      }),
    }),
    (error) =>
      /adb operation am start -W failed: signal SIGKILL/u.test(error.message) &&
      /stdout bytes 16; stderr bytes 13/u.test(error.message) &&
      !/sensitive|private/u.test(error.message),
  );
});

test('reports a nonzero diagnostics exit with redacted byte counts', async () => {
  await assert.rejects(
    openDiagnosticSmoke(9100, {
      runAdbAsync: async () => ({
        status: 7,
        signal: null,
        stdout: 'sensitive output',
        stderr: 'private error',
      }),
    }),
    (error) =>
      /adb operation am start -W failed: exit code 7/u.test(error.message) &&
      /stdout bytes 16; stderr bytes 13/u.test(error.message) &&
      !/sensitive|private/u.test(error.message),
  );
});

test('ignores the zero-byte TCP connect probe', async () => {
  const captures = [
    { bytesReceived: 0, sha256: 'empty' },
    { bytesReceived: 128, sha256: 'receipt' },
  ];
  const printer = {
    nextCapture: async () => captures.shift(),
  };

  assert.deepEqual(await waitForNonEmptyCapture(printer, 100), {
    bytesReceived: 128,
    sha256: 'receipt',
  });
});

test('fails when only zero-byte captures arrive', async () => {
  const printer = {
    nextCapture: async () => ({ bytesReceived: 0, sha256: 'empty' }),
  };

  await assert.rejects(
    waitForNonEmptyCapture(printer, 20),
    /Android printer smoke timed out/,
  );
});

test('clears each capture timeout after capture success or failure', async () => {
  const activeTimers = new Set();
  const clearedTimers = [];
  const timers = {
    setTimeout: () => {
      const timer = Object.freeze({ id: activeTimers.size + 1 });
      activeTimers.add(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      activeTimers.delete(timer);
      clearedTimers.push(timer);
    },
  };

  await waitForNonEmptyCapture(
    { nextCapture: async () => ({ bytesReceived: 1, sha256: 'capture' }) },
    100,
    timers,
  );
  await assert.rejects(
    waitForNonEmptyCapture(
      { nextCapture: async () => Promise.reject(new Error('capture failed')) },
      100,
      timers,
    ),
    /capture failed/,
  );

  assert.equal(clearedTimers.length, 2);
  assert.equal(activeTimers.size, 0);
});

test('requires the exact rendered bytes hash', () => {
  assert.doesNotThrow(() =>
    requireExpectedCapture(
      { bytesReceived: 3, sha256: 'expected' },
      { bytesReceived: 3, sha256: 'expected' },
    ),
  );
  assert.throws(
    () =>
      requireExpectedCapture(
        { bytesReceived: 3, sha256: 'unexpected' },
        { bytesReceived: 3, sha256: 'expected' },
      ),
    /bytes hash mismatch/,
  );
});

test('requires the exact DROP_AFTER_BYTES prefix length and hash', () => {
  const completeBytes = Buffer.from('expected printer payload');
  const dropAfterBytes = 4;
  const expected = {
    bytesReceived: completeBytes.length,
    sha256: 'complete-hash',
    dropAfterBytes,
    prefixSha256: createHash('sha256')
      .update(completeBytes.subarray(0, dropAfterBytes))
      .digest('hex'),
  };

  assert.doesNotThrow(() =>
    requireTruncatedCapture(
      { bytesReceived: dropAfterBytes, sha256: expected.prefixSha256 },
      expected,
    ),
  );
  assert.throws(
    () =>
      requireTruncatedCapture(
        { bytesReceived: dropAfterBytes, sha256: 'wrong-prefix-content' },
        expected,
      ),
    /exact expected prefix/,
  );
  assert.throws(
    () =>
      requireTruncatedCapture(
        { bytesReceived: dropAfterBytes - 1, sha256: expected.prefixSha256 },
        expected,
      ),
    /exact expected prefix/,
  );
});

test('requires the app result to match the smoke scenario', () => {
  assert.doesNotThrow(() =>
    requireSmokeResult('BAKE_TERMINAL_SMOKE_RESULT:SUCCESS', 'SUCCESS'),
  );
  assert.throws(
    () => requireSmokeResult('BAKE_TERMINAL_SMOKE_RESULT:SUCCESS', 'FAILED'),
    /result mismatch/,
  );
});

test('requires exactly one complete smoke terminal marker line', () => {
  for (const logs of [
    'BAKE_TERMINAL_SMOKE_RESULT:SUCCESS\nBAKE_TERMINAL_SMOKE_RESULT:FAILED',
    'BAKE_TERMINAL_SMOKE_RESULT:SUCCESS\nBAKE_TERMINAL_SMOKE_RESULT:SUCCESS',
    'BAKE_TERMINAL_SMOKE_RESULT:FAILED_RETRYING',
    'quoted BAKE_TERMINAL_SMOKE_RESULT:SUCCESS',
  ]) {
    assert.throws(() => requireSmokeResult(logs, 'SUCCESS'), /result mismatch/);
  }
});

test('reads smoke logs only for one valid target package PID', async () => {
  const calls = [];
  const runAdb = (arguments_) => {
    calls.push(arguments_);
    if (arguments_[0] === 'shell') {
      return { status: 0, stdout: '4242\n', stderr: '' };
    }
    return {
      status: 0,
      stdout: 'BAKE_TERMINAL_SMOKE_RESULT:SUCCESS\n',
      stderr: '',
    };
  };

  const logs = await waitForSmokeResult('SUCCESS', 50, { runAdb });

  assert.match(logs, /BAKE_TERMINAL_SMOKE_RESULT:SUCCESS/u);
  assert.deepEqual(calls, [
    ['shell', 'pidof', packageName],
    ['logcat', '-v', 'raw', '--pid=4242', '-d'],
  ]);
});

test('fails closed when the target package PID is missing or invalid', async () => {
  for (const stdout of ['', '0', '42 43', 'not-a-pid']) {
    await assert.rejects(
      waitForSmokeResult('SUCCESS', 50, {
        runAdb: () => ({ status: stdout ? 0 : 1, stdout, stderr: '' }),
      }),
      /valid PID/,
    );
  }
});
