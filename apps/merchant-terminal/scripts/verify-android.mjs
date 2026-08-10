import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startFakePrinter } from './fake-printer-server.mjs';

const apkPath = process.env.MERCHANT_TERMINAL_DEBUG_APK
  ? resolve(process.env.MERCHANT_TERMINAL_DEBUG_APK)
  : null;
const packageName = 'com.bakemall.merchantterminal';
const ADB_TIMEOUT_MS = 15_000;
const APK_ANALYZER_TIMEOUT_MS = 15_000;
const adbCallOptions = Object.freeze({ timeout: ADB_TIMEOUT_MS });
const apkAnalyzerCallOptions = Object.freeze({
  timeout: APK_ANALYZER_TIMEOUT_MS,
});
const execFileAsync = promisify(execFile);

const toAdbResult = (value) => {
  if (
    value !== null &&
    typeof value === 'object' &&
    'status' in value &&
    ('stdout' in value || 'stderr' in value)
  ) {
    return {
      status: Number.isInteger(value.status) ? value.status : null,
      stdout: String(value.stdout ?? ''),
      stderr: String(value.stderr ?? ''),
      error: value.error,
      signal: value.signal ?? null,
    };
  }
  return {
    status: 0,
    stdout: String(value ?? ''),
    stderr: '',
    error: undefined,
    signal: null,
  };
};

export const runAdbCommand = (
  arguments_,
  spawnCommand = spawnSync,
  callOptions = adbCallOptions,
) => {
  const result = spawnCommand('adb', arguments_, {
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
    timeout: callOptions.timeout,
  });
  return toAdbResult(result);
};

const runAdb = runAdbCommand;

const executeAdb = (executor, arguments_) => {
  try {
    return toAdbResult(executor(arguments_, adbCallOptions));
  } catch (error) {
    return {
      status: Number.isInteger(error?.status) ? error.status : null,
      stdout: String(error?.stdout ?? ''),
      stderr: String(error?.stderr ?? ''),
      error,
      signal: error?.signal ?? null,
    };
  }
};

const adbOutput = (result) =>
  [result.stdout, result.stderr].filter(Boolean).join('\n');

const isAdbTimeout = (result) =>
  result?.error?.code === 'ETIMEDOUT' ||
  result?.error?.killed === true ||
  result?.signal === 'SIGTERM' ||
  result?.signal === 'SIGKILL';

const requireAdbOperationResult = (operation, result) => {
  if (isAdbTimeout(result)) {
    throw new Error(`adb operation ${operation} timed out.`);
  }
  if (result?.error || result?.signal || result?.status === null) {
    throw new Error(`adb operation ${operation} failed.`);
  }
};

const requireAdb = () => {
  const result = runAdb(['version']);
  if (result.status !== 0 || !result.stdout.includes('Android Debug Bridge')) {
    throw new Error('adb is required for Android verification');
  }
};

const requireApk = async (candidatePath) => {
  try {
    if (
      !candidatePath ||
      extname(candidatePath).toLowerCase() !== '.apk' ||
      !(await stat(candidatePath)).isFile()
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      'MERCHANT_TERMINAL_DEBUG_APK must reference a regular .apk file; App resources are not an APK.',
    );
  }
};

export const resolveApkAnalyzerCommand = (
  platform = process.platform,
  environment = process.env,
) =>
  environment.MERCHANT_TERMINAL_APKANALYZER ||
  (platform === 'win32' ? 'apkanalyzer.bat' : 'apkanalyzer');

const WINDOWS_CMD_UNSAFE_ARGUMENT = /["\r\n&^%!()]/u;
const NUL_CHARACTER = String.fromCharCode(0);

export const buildWindowsCommandLine = (arguments_) => {
  if (
    !Array.isArray(arguments_) ||
    arguments_.length === 0 ||
    arguments_.some(
      (argument) =>
        typeof argument !== 'string' ||
        argument.includes(NUL_CHARACTER) ||
        WINDOWS_CMD_UNSAFE_ARGUMENT.test(argument),
    )
  ) {
    throw new Error('Unsafe Windows command argument.');
  }
  const quote = (argument) => `"${argument.replaceAll('"', '""')}"`;
  return `"${arguments_.map(quote).join(' ')}"`;
};

export const runApkAnalyzerCommand = (
  arguments_,
  spawnCommand = spawnSync,
  options = {},
) => {
  const platform = options.platform ?? process.platform;
  const command =
    options.command || resolveApkAnalyzerCommand(platform, process.env);
  const isWindowsBatch =
    platform === 'win32' && /\.(?:bat|cmd)$/iu.test(command);
  const executable = isWindowsBatch
    ? options.comSpec || process.env.ComSpec || 'cmd.exe'
    : command;
  const analyzerArguments = isWindowsBatch
    ? [
        '/d',
        '/v:off',
        '/s',
        '/c',
        buildWindowsCommandLine([command, ...arguments_]),
      ]
    : arguments_;
  return toAdbResult(
    spawnCommand(executable, analyzerArguments, {
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true,
      timeout: APK_ANALYZER_TIMEOUT_MS,
    }),
  );
};

const defaultRunApkAnalyzer = runApkAnalyzerCommand;

const verifyApkApplicationId = async (candidatePath, runner) => {
  let result;
  try {
    result = toAdbResult(
      await runner(
        ['manifest', 'application-id', candidatePath],
        apkAnalyzerCallOptions,
      ),
    );
  } catch (error) {
    result = toAdbResult({
      status: Number.isInteger(error?.status) ? error.status : null,
      stdout: error?.stdout,
      stderr: error?.stderr,
      error,
      signal: error?.signal,
    });
  }

  if (isAdbTimeout(result)) {
    throw new Error('APK identity verification timed out.');
  }
  if (
    result.error ||
    result.signal ||
    result.status !== 0 ||
    result.stderr.trim() ||
    !result.stdout.trim()
  ) {
    throw new Error('APK identity verification failed.');
  }
  if (result.stdout.trim() !== packageName) {
    throw new Error('APK application ID does not match the merchant terminal.');
  }
};

const isExplicitMissingPackage = (output) =>
  /Unknown package|not installed/u.test(output);

const hasFailureResult = (output) =>
  String(output)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .some((line) => /^Failure\b/u.test(line));

const hasIndependentSuccessResult = (output) => {
  const lines = String(output)
    .split(/\r?\n/u)
    .map((line) => line.trim());
  return (
    !hasFailureResult(output) &&
    lines.filter((line) => line === 'Success').length === 1
  );
};

const readInstalledPackagePath = (executor) => {
  const result = executeAdb(executor, ['shell', 'pm', 'path', packageName]);
  requireAdbOperationResult('pm path', result);
  const output = adbOutput(result).trim();
  if (isExplicitMissingPackage(output)) return null;
  if (result.status === 1 && !output) return null;
  if (result.status !== 0 || hasFailureResult(output) || !output) {
    throw new Error(`Unable to query installed package ${packageName}.`);
  }
  if (
    output.split(/\r?\n/u).every((line) => line.trim().startsWith('package:'))
  ) {
    return output;
  }
  throw new Error(`Unable to query installed package ${packageName}.`);
};

export const verifyAndroidInstallation = async (
  candidatePath,
  dependencies = {},
) => {
  const executeAdbCommand = dependencies.runAdb ?? runAdb;
  const runApkAnalyzer = dependencies.runApkAnalyzer ?? defaultRunApkAnalyzer;
  await requireApk(candidatePath);
  const resolvedApkPath = resolve(candidatePath);
  await verifyApkApplicationId(resolvedApkPath, runApkAnalyzer);

  let uninstallError = null;
  const uninstallResult = executeAdb(executeAdbCommand, [
    'uninstall',
    packageName,
  ]);
  const uninstallOutput = adbOutput(uninstallResult);
  if (isAdbTimeout(uninstallResult)) {
    throw new Error('adb operation uninstall timed out.');
  }
  if (
    !isExplicitMissingPackage(uninstallOutput) &&
    (uninstallResult.signal ||
      (uninstallResult.status === null && uninstallResult.error?.code))
  ) {
    throw new Error('adb operation uninstall failed.');
  }
  if (
    !isExplicitMissingPackage(uninstallOutput) &&
    (uninstallResult.status !== 0 ||
      hasFailureResult(uninstallOutput) ||
      !hasIndependentSuccessResult(uninstallOutput))
  ) {
    uninstallError = new Error('adb uninstall failed');
  }

  let oldPackagePath;
  try {
    oldPackagePath = readInstalledPackagePath(executeAdbCommand);
  } catch (error) {
    if (/^adb operation pm path /u.test(error.message)) throw error;
    throw new Error(
      `Failed to uninstall ${packageName}: unable to confirm package absence.`,
    );
  }
  if (oldPackagePath) {
    throw new Error(
      `Failed to uninstall ${packageName}: old fixed package remains installed.`,
    );
  }
  if (uninstallError) {
    throw new Error(`Failed to uninstall ${packageName}.`);
  }

  const installResult = executeAdb(executeAdbCommand, [
    'install',
    '-r',
    resolvedApkPath,
  ]);
  requireAdbOperationResult('install', installResult);
  if (
    installResult.status !== 0 ||
    !hasIndependentSuccessResult(adbOutput(installResult))
  ) {
    throw new Error('adb install failed.');
  }
  if (!readInstalledPackagePath(executeAdbCommand)) {
    throw new Error(`Installed APK does not provide ${packageName}.`);
  }
};

const requireConnectedDevice = () => {
  const result = runAdb(['devices']);
  if (result.status !== 0) {
    throw new Error('Android verification requires exactly one adb device');
  }
  const devices = result.stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.endsWith('\tdevice'));

  if (devices.length !== 1) {
    throw new Error('Android verification requires exactly one adb device');
  }
};

export const requireExpectedCapture = (capture, expected) => {
  if (
    capture.bytesReceived !== expected.bytesReceived ||
    capture.sha256 !== expected.sha256
  ) {
    throw new Error('Android printer smoke bytes hash mismatch');
  }
};

const smokeResultPrefix = 'BAKE_TERMINAL_SMOKE_RESULT:';
const smokeResultPattern = /^BAKE_TERMINAL_SMOKE_RESULT:(SUCCESS|FAILED)$/u;

const readSmokeResults = (logs) =>
  String(logs)
    .split(/\r?\n/u)
    .filter((line) => line.includes(smokeResultPrefix))
    .map((line) => smokeResultPattern.exec(line)?.[1] ?? null);

export const requireSmokeResult = (logs, expectedResult) => {
  const results = readSmokeResults(logs);
  if (results.length !== 1 || results[0] !== expectedResult) {
    throw new Error('Android printer smoke result mismatch');
  }
};

export const requireTruncatedCapture = (capture, expected) => {
  if (
    capture.bytesReceived !== expected.dropAfterBytes ||
    capture.sha256 !== expected.prefixSha256
  ) {
    throw new Error(
      'Android printer smoke mid-write capture did not match the exact expected prefix',
    );
  }
};

export const waitForNonEmptyCapture = async (
  printer,
  timeoutMs,
  timers = { setTimeout, clearTimeout },
) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    let timeout;
    try {
      const capture = await Promise.race([
        printer.nextCapture(),
        new Promise((_, reject) => {
          timeout = timers.setTimeout(
            () => reject(new Error('Android printer smoke timed out')),
            remainingMs,
          );
        }),
      ]);
      if (capture.bytesReceived > 0) return capture;
    } finally {
      if (timeout !== undefined) timers.clearTimeout(timeout);
    }
  }

  throw new Error('Android printer smoke timed out');
};

const expectedBytes = Buffer.from(
  '[ASCII]\nASCII TEST: BAKE MALL 123\n',
  'ascii',
);
const DROP_AFTER_BYTES = 4;
const expectedCapture = {
  bytesReceived: expectedBytes.length,
  sha256: createHash('sha256').update(expectedBytes).digest('hex'),
  dropAfterBytes: DROP_AFTER_BYTES,
  prefixSha256: createHash('sha256')
    .update(expectedBytes.subarray(0, DROP_AFTER_BYTES))
    .digest('hex'),
};

export const waitForSmokeResult = async (
  expectedResult,
  timeoutMs,
  dependencies = {},
) => {
  const executeAdbCommand = dependencies.runAdb ?? runAdb;
  const pidResult = executeAdb(executeAdbCommand, [
    'shell',
    'pidof',
    packageName,
  ]);
  requireAdbOperationResult('pidof', pidResult);
  const pid = adbOutput(pidResult).trim();
  if (pidResult.status !== 0 || !/^[1-9]\d*$/u.test(pid)) {
    throw new Error('Android printer smoke requires one valid PID');
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const logResult = executeAdb(executeAdbCommand, [
      'logcat',
      '-v',
      'raw',
      `--pid=${pid}`,
      '-d',
    ]);
    requireAdbOperationResult('logcat', logResult);
    if (logResult.status !== 0) {
      throw new Error('Android printer smoke logcat query failed');
    }
    const logs = adbOutput(logResult);
    const results = readSmokeResults(logs);
    if (results.length > 0) {
      requireSmokeResult(logs, expectedResult);
      return logs;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error('Android printer smoke result timed out');
};

export const clearAndroidLogs = (dependencies = {}) => {
  const result = executeAdb(dependencies.runAdb ?? runAdb, ['logcat', '-c']);
  requireAdbOperationResult('logcat -c', result);
  if (result.status !== 0 || adbOutput(result).trim()) {
    throw new Error('adb operation logcat -c failed');
  }
};

const defaultRunAdbAsync = async (arguments_, options) => {
  const { stdout, stderr } = await execFileAsync('adb', arguments_, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout,
  });
  return { status: 0, signal: null, stdout, stderr };
};

const adbByteCounts = (result) => ({
  stdoutBytes: Buffer.byteLength(String(result?.stdout ?? '')),
  stderrBytes: Buffer.byteLength(String(result?.stderr ?? '')),
});

export const openDiagnosticSmoke = async (port, dependencies = {}) => {
  const runAdbAsync = dependencies.runAdbAsync ?? defaultRunAdbAsync;
  const arguments_ = [
    'shell',
    'am',
    'start',
    '-W',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    `bakemall-terminal://diagnostics?smoke=true&host=10.0.2.2&port=${port}`,
    '-p',
    packageName,
  ];

  let result;
  try {
    result = await runAdbAsync(arguments_, adbCallOptions);
  } catch (error) {
    const { stdoutBytes, stderrBytes } = adbByteCounts(error);
    const timedOut =
      error?.code === 'ETIMEDOUT' ||
      error?.killed === true ||
      error?.signal === 'SIGTERM' ||
      error?.signal === 'SIGKILL';
    throw new Error(
      `adb operation am start -W ${timedOut ? 'timed out' : 'failed'}; stdout bytes ${stdoutBytes}; stderr bytes ${stderrBytes}`,
    );
  }

  const { stdoutBytes, stderrBytes } = adbByteCounts(result);
  if (result.status !== 0 || result.signal) {
    const exit = result.signal
      ? `signal ${result.signal}`
      : `exit code ${result.status ?? 'unknown'}`;
    throw new Error(
      `adb operation am start -W failed: ${exit}; stdout bytes ${stdoutBytes}; stderr bytes ${stderrBytes}`,
    );
  }
};

const verifyPrinterScenario = async (
  options,
  expectedResult,
  verifyCapture,
) => {
  const printer = await startFakePrinter(options);
  try {
    clearAndroidLogs();
    await openDiagnosticSmoke(printer.port);
    const capture = await waitForNonEmptyCapture(printer, 15_000);
    verifyCapture(capture, expectedCapture);
    const logs = await waitForSmokeResult(expectedResult, 15_000);
    requireSmokeResult(logs, expectedResult);
  } finally {
    await printer.close();
  }
};

const verifyFakePrinterReachability = async () => {
  await verifyPrinterScenario(
    { mode: 'COMPLETE' },
    'SUCCESS',
    requireExpectedCapture,
  );
  await verifyPrinterScenario(
    { mode: 'DROP_AFTER_BYTES', bytes: DROP_AFTER_BYTES },
    'FAILED',
    requireTruncatedCapture,
  );
};

const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  requireAdb();
  requireConnectedDevice();
  await verifyAndroidInstallation(apkPath);
  await verifyFakePrinterReachability();
  console.log('Android printer smoke passed');
}
