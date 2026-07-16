# 可迁移 Claude Code + Superpowers 规范包实施计划

> **供代理执行：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务实施。步骤使用复选框跟踪。

**目标：** 构建一个零依赖、幂等且不覆盖目标项目已有指令的工具包，用单条 Node 命令安装和验证通用 Claude Code + Superpowers 协作规范。

**架构：** `template.md` 是唯一规范源；`install.mjs` 只创建或更新目标 `.claude/CLAUDE.md` 的标记区块；`verify.mjs` 对安装状态做只读验证。安装和验证的纯逻辑从 CLI 文件导出，使用 Node 标准库临时目录执行端到端测试。

**技术栈：** Node.js >=22.13、ESM、Node 标准库、`node:assert/strict`、Prettier、ESLint。

## 全局约束

- 所有规格、计划、任务简报、实施报告和 README 自然语言使用中文；代码、命令、路径、API、标识符及必要技术术语保留英文。
- 长任务只维护少量用户可见顶层任务，用户可通过 `/tasks` 查看；子代理内部步骤不得创建为顶层任务。
- 每完成顶层任务主动播报 `进度 N/M`、结果和下一步；`.superpowers/sdd/progress.md` 只用于恢复。
- 不引入 npm 依赖，不执行目标项目代码，不修改用户级设置、目标 settings、hooks 或 skills。
- 不直接修改 `~/.claude/plugins/cache/` 中的第三方插件。
- 安装器只管理自身标记区块，区块外内容逐字保留。
- 标记损坏时安全失败，不猜测、不覆盖。
- 不创建 Git commit。

---

### 任务 1：定义规范模板和安装核心

**文件：**
- 新建：`tools/claude-superpowers-kit/template.md`
- 新建：`tools/claude-superpowers-kit/install.mjs`
- 新建：`tools/claude-superpowers-kit/install.test.mjs`

**接口：**
- `START_MARKER: string`
- `END_MARKER: string`
- `buildManagedBlock(template: string): string`
- `mergeManagedBlock(existing: string, template: string): string`
- `installKit(targetDirectory: string): Promise<{ path: string; changed: boolean }>`

- [ ] **步骤 1：创建规范模板**

`template.md` 写入以下通用规则：

```markdown
## Claude Code + Superpowers 协作规范

- 用户沟通以及 `docs/superpowers/specs/`、`docs/superpowers/plans/`、`.superpowers/sdd/` 中的规格、计划、任务简报和报告默认使用中文；代码、命令、路径、API、标识符及必要技术术语保留英文。即使上游 skill 提供英文模板，也必须保留结构并将自然语言本地化为中文。
- 长任务使用 `TaskCreate` / `TaskUpdate` 维护少量用户可见的顶层任务，用户可通过 `/tasks` 查看；顶层任务按用户可理解的成果划分，子代理内部实现步骤不得创建为顶层任务。
- 每完成一个顶层任务，主动播报 `进度 N/M`、当前结果和下一步；发生阻塞时立即说明阻塞点，并将当前任务恢复为 pending/open，避免任务长期停留在 in_progress。
- `.superpowers/sdd/progress.md` 只用于会话压缩或恢复后的持久账本，不能替代 `/tasks` 和里程碑播报。
- 每份新实施计划的“全局约束”必须重复关键语言与任务可见性规则，确保隔离子代理收到约束。
- 遇到反复出现且可跨会话复用的规范缺口时，先向用户说明原因和拟新增规则；用户批准后再沉淀到项目 `CLAUDE.md`。一次性问题不写成永久规则。
- 不直接修改 `~/.claude/plugins/cache/` 中的 Superpowers 或其他第三方插件缓存；项目覆盖规则写入项目 `CLAUDE.md`，需要定制插件时使用独立 fork 或项目工具。
```

- [ ] **步骤 2：先写安装核心失败测试**

在 `install.test.mjs` 导入尚不存在的接口，测试：

```js
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

const template = '## 通用规则\n\n- 使用中文。\n';

assert.match(mergeManagedBlock('', template), new RegExp(START_MARKER));
assert.match(mergeManagedBlock('', template), new RegExp(END_MARKER));
assert.match(
  mergeManagedBlock('# 原有规则\n', template),
  /^# 原有规则\n\n<!-- claude-superpowers-kit:start -->/,
);
assert.throws(
  () => mergeManagedBlock(`${START_MARKER}\n损坏`, template),
  /托管标记不完整/,
);
```

临时目录部分继续覆盖创建、保留已有内容、重复安装字节级不变和完整旧区块原位更新，并在 `finally` 中删除临时目录。

- [ ] **步骤 3：运行测试确认失败**

```bash
node tools/claude-superpowers-kit/install.test.mjs
```

预期：FAIL，无法解析 `install.mjs` 或缺少导出。

- [ ] **步骤 4：实现安装核心与 CLI**

`install.mjs` 使用：

```js
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const START_MARKER = '<!-- claude-superpowers-kit:start -->';
export const END_MARKER = '<!-- claude-superpowers-kit:end -->';

export function buildManagedBlock(template) {
  return `${START_MARKER}\n${template.trim()}\n${END_MARKER}`;
}
```

`mergeManagedBlock`：

1. 统计两个标记出现次数。
2. 两者均为零时，在空文件直接写区块；非空文件先移除末尾空白，再追加两个换行和区块，最后加换行。
3. 两者各一次且开始位置早于结束位置时，替换含标记的整个区间，保留前后内容。
4. 其他状态抛出包含“托管标记不完整或重复”的错误。

`installKit`：

1. `resolve(targetDirectory)`。
2. 使用 `stat` 验证目标存在且为目录。
3. 从 `new URL('./template.md', import.meta.url)` 读取模板。
4. 创建 `<target>/.claude`。
5. 读取或以空字符串处理 `<target>/.claude/CLAUDE.md` 不存在。
6. 生成新内容；若完全相同则返回 `{ changed: false }`。
7. 将内容写入同目录唯一临时文件，再 `rename` 原子替换。
8. 返回绝对目标路径和 `changed`。

CLI 参数省略时使用 `process.cwd()`，成功打印安装/已是最新状态及验证命令；失败打印错误并设置 `process.exitCode = 1`。使用 `process.argv[1] === fileURLToPath(import.meta.url)` 保护 CLI 入口。

- [ ] **步骤 5：运行安装测试**

```bash
node tools/claude-superpowers-kit/install.test.mjs
```

预期：安装相关断言全部通过。

---

### 任务 2：实现只读验证器和损坏标记覆盖

**文件：**
- 新建：`tools/claude-superpowers-kit/verify.mjs`
- 修改：`tools/claude-superpowers-kit/install.test.mjs`

**接口：**
- `verifyKit(targetDirectory: string): Promise<{ path: string; valid: true }>`

- [ ] **步骤 1：扩展失败测试**

向 `install.test.mjs` 添加：

- 安装完成后 `verifyKit(tempProject)` 成功。
- 篡改托管区块中的 `/tasks` 后验证失败，错误包含“托管区块与模板不一致”。
- 只有结束标记、重复开始标记、结束标记在开始标记之前时，`mergeManagedBlock` 均抛错。
- 安装损坏文件前记录内容，失败后内容字节级不变。

- [ ] **步骤 2：运行测试确认失败**

```bash
node tools/claude-superpowers-kit/install.test.mjs
```

预期：FAIL，无法解析 `verify.mjs` 或验证接口不存在。

- [ ] **步骤 3：实现验证器**

`verify.mjs`：

1. 从目标 `.claude/CLAUDE.md` 读取内容。
2. 从同目录 `template.md` 读取当前模板。
3. 要求两个标记各出现一次、顺序正确。
4. 截取完整标记区块，与 `buildManagedBlock(template)` 完全比较。
5. 检查托管区块包含：`/tasks`、`进度 N/M`、`.superpowers/sdd/progress.md`、`本地化为中文`、`plugins/cache`。
6. 任一失败抛出具体中文错误；成功返回绝对路径和 `valid: true`。
7. CLI 目标省略时使用 `process.cwd()`，成功打印通过信息，失败设置非零退出码。

- [ ] **步骤 4：运行完整测试**

```bash
node tools/claude-superpowers-kit/install.test.mjs
```

预期：所有安装、幂等、标记损坏和验证断言通过。

---

### 任务 3：编写迁移文档和项目命令

**文件：**
- 新建：`tools/claude-superpowers-kit/README.md`
- 修改：`package.json`

**接口：**
- `pnpm test:claude-superpowers-kit`
- `pnpm verify:claude-superpowers-kit`

- [ ] **步骤 1：编写中文 README**

README 包含：

```bash
node tools/claude-superpowers-kit/install.mjs /path/to/project
node tools/claude-superpowers-kit/verify.mjs /path/to/project
```

并说明：

- 复制整个 `tools/claude-superpowers-kit/` 到其他仓库即可使用。
- 安装器只管理标记区块，不覆盖已有规则。
- 重复运行用于升级模板。
- 手工卸载只删除起止标记及其内部内容。
- `/tasks` 是用户查看顶层任务的入口。
- 可选用户级设置为 `{"language":"chinese"}`，但不能代替项目 `CLAUDE.md`。
- 新会话用 `/memory` 检查项目规则是否加载。
- 不直接改第三方插件缓存，因为升级会覆盖且难以迁移。

- [ ] **步骤 2：增加根 scripts**

`package.json` 增加：

```json
"test:claude-superpowers-kit": "node tools/claude-superpowers-kit/install.test.mjs",
"verify:claude-superpowers-kit": "node tools/claude-superpowers-kit/verify.mjs ."
```

- [ ] **步骤 3：运行测试与当前仓库验证**

先将工具包安装到当前仓库，使当前 `.claude/CLAUDE.md` 获得托管区块，同时保留原有 bake-mall 规则：

```bash
node tools/claude-superpowers-kit/install.mjs .
pnpm test:claude-superpowers-kit
pnpm verify:claude-superpowers-kit
```

预期：安装成功；测试和验证均退出 0；原有 `# CLAUDE.md` 与 bake-mall 规则仍存在。

---

### 任务 4：执行质量检查和真实迁移验收

**文件：**
- 验证：`tools/claude-superpowers-kit/*`
- 验证：`.claude/CLAUDE.md`

**接口：**
- 工具包可从仓库外的任意 cwd 安装到独立目标项目。

- [ ] **步骤 1：运行 ESLint、Prettier 和 diff 检查**

```bash
pnpm exec eslint tools/claude-superpowers-kit/*.mjs
pnpm exec prettier --check tools/claude-superpowers-kit .claude/CLAUDE.md package.json
git diff --check
```

预期：全部退出 0。

- [ ] **步骤 2：从独立 cwd 做真实安装**

```bash
source_project="$PWD"
target_project="$(mktemp -d)"
run_directory="$(mktemp -d)"
printf '# 目标项目原有规则\n' > "$target_project/original.md"
(
  cd "$run_directory"
  node "$source_project/tools/claude-superpowers-kit/install.mjs" "$target_project"
  node "$source_project/tools/claude-superpowers-kit/verify.mjs" "$target_project"
)
test -f "$target_project/.claude/CLAUDE.md"
rg -n '/tasks|进度 N/M|\.superpowers/sdd/progress\.md' "$target_project/.claude/CLAUDE.md"
rm -rf "$target_project" "$run_directory"
```

预期：安装和验证成功，关键规则存在。

- [ ] **步骤 3：检查当前仓库原有规则保留**

```bash
rg -n 'bake-mall|金额字段|订单状态机|frontend-page-generator' .claude/CLAUDE.md
git status --short
```

预期：项目专属规则仍存在；只有预期的工具包、文档、上下文和既有工作区修改出现；未生成环境秘密或 commit。

- [ ] **步骤 4：最终功能验证**

```bash
pnpm test:claude-superpowers-kit
pnpm verify:claude-superpowers-kit
git diff --check
```

预期：全部通过，并可向用户报告一键迁移命令和任务可见性推荐。
