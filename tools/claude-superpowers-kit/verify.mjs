import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { END_MARKER, START_MARKER, buildManagedBlock } from './install.mjs';

const REQUIRED_SNIPPETS = [
  '/tasks',
  '进度 N/M',
  '.superpowers/sdd/progress.md',
  '本地化为中文',
  'plugins/cache',
];

function countOccurrences(contents, marker) {
  return contents.split(marker).length - 1;
}

function extractManagedBlock(contents) {
  const startCount = countOccurrences(contents, START_MARKER);
  const endCount = countOccurrences(contents, END_MARKER);
  const startIndex = contents.indexOf(START_MARKER);
  const endIndex = contents.indexOf(END_MARKER);

  if (startCount !== 1 || endCount !== 1 || startIndex >= endIndex) {
    throw new Error('托管标记不完整、重复或顺序错误。');
  }

  return contents.slice(startIndex, endIndex + END_MARKER.length);
}

export async function verifyKit(targetDirectory = process.cwd()) {
  const target = resolve(targetDirectory);
  const claudePath = join(target, '.claude', 'CLAUDE.md');
  let contents;
  try {
    contents = await readFile(claudePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`未找到 Claude 项目指令：${claudePath}`);
    }
    throw error;
  }

  const template = await readFile(
    new URL('./template.md', import.meta.url),
    'utf8',
  );
  const managedBlock = extractManagedBlock(contents);
  if (managedBlock !== buildManagedBlock(template)) {
    throw new Error('托管区块与模板不一致，请重新运行安装器。');
  }

  const missingSnippets = REQUIRED_SNIPPETS.filter(
    (snippet) => !managedBlock.includes(snippet),
  );
  if (missingSnippets.length > 0) {
    throw new Error(`托管区块缺少关键规则：${missingSnippets.join('、')}`);
  }

  return { path: claudePath, valid: true };
}

async function main() {
  const target = process.argv[2] ?? process.cwd();
  try {
    const result = await verifyKit(target);
    console.log(`规范包验证通过：${result.path}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
