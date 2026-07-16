import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  END_MARKER,
  START_MARKER,
  installKit,
  mergeManagedBlock,
} from './install.mjs';
import { verifyKit } from './verify.mjs';

const template = '## 通用规则\n\n- 使用中文。\n';

assert.match(mergeManagedBlock('', template), new RegExp(START_MARKER));
assert.match(mergeManagedBlock('', template), new RegExp(END_MARKER));
assert.match(
  mergeManagedBlock('# 原有规则\n', template),
  /^# 原有规则\n\n<!-- claude-superpowers-kit:start -->/,
);
[
  `${START_MARKER}\n损坏`,
  `损坏\n${END_MARKER}`,
  `${START_MARKER}\n${START_MARKER}\n${END_MARKER}`,
  `${END_MARKER}\n${START_MARKER}`,
].forEach((contents) => {
  assert.throws(
    () => mergeManagedBlock(contents, template),
    /托管标记不完整或重复/,
  );
});

const root = await mkdtemp(join(tmpdir(), 'claude-superpowers-kit-'));

try {
  const emptyProject = join(root, 'empty');
  await mkdir(emptyProject);
  const firstInstall = await installKit(emptyProject);
  const firstContents = await readFile(firstInstall.path, 'utf8');
  assert.equal(firstInstall.changed, true);
  assert.match(firstContents, /Claude Code \+ Superpowers 协作规范/);

  const secondInstall = await installKit(emptyProject);
  const secondContents = await readFile(secondInstall.path, 'utf8');
  assert.equal(secondInstall.changed, false);
  assert.equal(secondContents, firstContents);
  assert.deepEqual(await verifyKit(emptyProject), {
    path: firstInstall.path,
    valid: true,
  });

  await writeFile(
    firstInstall.path,
    firstContents.replace('/tasks', '/task-list'),
  );
  await assert.rejects(() => verifyKit(emptyProject), /托管区块与模板不一致/);

  const existingProject = join(root, 'existing');
  await mkdir(join(existingProject, '.claude'), { recursive: true });
  const existingPath = join(existingProject, '.claude', 'CLAUDE.md');
  await writeFile(existingPath, '# 目标项目\n\n- 保留此规则。\n');
  await installKit(existingProject);
  const existingContents = await readFile(existingPath, 'utf8');
  assert.match(existingContents, /^# 目标项目\n\n- 保留此规则。/);
  assert.match(existingContents, /claude-superpowers-kit:start/);

  const oldBlock = `${START_MARKER}\n旧规则\n${END_MARKER}`;
  await writeFile(existingPath, `前部\n${oldBlock}\n后部\n`);
  await installKit(existingProject);
  const updatedContents = await readFile(existingPath, 'utf8');
  assert.match(updatedContents, /^前部\n/);
  assert.match(updatedContents, /后部\n$/);
  assert.doesNotMatch(updatedContents, /旧规则/);

  const damagedPath = join(root, 'damaged.md');
  const damagedContents = `${START_MARKER}\n损坏`;
  await writeFile(damagedPath, damagedContents);
  const damagedProject = join(root, 'damaged-project');
  await mkdir(join(damagedProject, '.claude'), { recursive: true });
  const damagedClaudePath = join(damagedProject, '.claude', 'CLAUDE.md');
  await writeFile(damagedClaudePath, damagedContents);
  await assert.rejects(
    () => installKit(damagedProject),
    /托管标记不完整或重复/,
  );
  assert.equal(await readFile(damagedClaudePath, 'utf8'), damagedContents);
} finally {
  await rm(root, { recursive: true, force: true });
}
