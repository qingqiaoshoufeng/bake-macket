import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

export const START_MARKER = '<!-- claude-superpowers-kit:start -->';
export const END_MARKER = '<!-- claude-superpowers-kit:end -->';

function countOccurrences(contents, marker) {
  return contents.split(marker).length - 1;
}

function assertValidMarkers(contents) {
  const startCount = countOccurrences(contents, START_MARKER);
  const endCount = countOccurrences(contents, END_MARKER);
  const startIndex = contents.indexOf(START_MARKER);
  const endIndex = contents.indexOf(END_MARKER);
  const hasNoMarkers = startCount === 0 && endCount === 0;
  const hasValidMarkers =
    startCount === 1 && endCount === 1 && startIndex < endIndex;

  if (!hasNoMarkers && !hasValidMarkers) {
    throw new Error('托管标记不完整或重复，已拒绝修改目标文件。');
  }

  return { hasNoMarkers, startIndex, endIndex };
}

export function buildManagedBlock(template) {
  return `${START_MARKER}\n\n${template.trim()}\n\n${END_MARKER}`;
}

export function mergeManagedBlock(existing, template) {
  const markerState = assertValidMarkers(existing);
  const managedBlock = buildManagedBlock(template);

  if (markerState.hasNoMarkers) {
    const retained = existing.trimEnd();
    return retained ? `${retained}\n\n${managedBlock}\n` : `${managedBlock}\n`;
  }

  const blockEnd = markerState.endIndex + END_MARKER.length;
  return `${existing.slice(0, markerState.startIndex)}${managedBlock}${existing.slice(blockEnd)}`;
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
}

async function assertTargetDirectory(targetDirectory) {
  let targetStat;
  try {
    targetStat = await stat(targetDirectory);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`目标项目不存在：${targetDirectory}`);
    }
    throw error;
  }

  if (!targetStat.isDirectory()) {
    throw new Error(`目标项目不是目录：${targetDirectory}`);
  }
}

async function writeAtomically(path, contents) {
  const temporaryPath = `${path}.claude-superpowers-kit-${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, contents, 'utf8');
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function installKit(targetDirectory = process.cwd()) {
  const target = resolve(targetDirectory);
  await assertTargetDirectory(target);

  const template = await readFile(
    new URL('./template.md', import.meta.url),
    'utf8',
  );
  const claudePath = join(target, '.claude', 'CLAUDE.md');
  const existing = await readOptional(claudePath);
  const next = mergeManagedBlock(existing, template);

  if (next === existing) return { path: claudePath, changed: false };

  await mkdir(dirname(claudePath), { recursive: true });
  await writeAtomically(claudePath, next);
  return { path: claudePath, changed: true };
}

async function main() {
  const target = process.argv[2] ?? process.cwd();
  try {
    const result = await installKit(target);
    const state = result.changed ? '已安装或更新' : '已是最新版本';
    console.log(`${state}：${result.path}`);
    console.log(
      `验证命令：node ${fileURLToPath(new URL('./verify.mjs', import.meta.url))} ${resolve(target)}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
