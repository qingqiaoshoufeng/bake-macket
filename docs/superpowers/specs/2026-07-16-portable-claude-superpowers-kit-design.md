# 可迁移 Claude Code + Superpowers 规范包设计

**状态：** 已批准

## 1. 目标

在当前仓库中提供一个零依赖工具包，使开发者能用单条 Node 命令把通用的 Claude Code + Superpowers 协作规范安装到任意目标项目，同时满足：

- 默认中文产出；
- 用户可通过 `/tasks` 查看少量顶层任务；
- 每完成一个顶层任务主动播报 `进度 N/M`；
- 子代理内部步骤不污染用户可见任务列表；
- `.superpowers/sdd/progress.md` 只用于会话恢复；
- 可复用的流程缺口经用户批准后沉淀到项目 `CLAUDE.md`；
- 安装幂等，不覆盖目标项目已有指令。

## 2. 范围

默认只迁移通用协作规范，不迁移 bake-mall 的技术栈、业务约束、前端技能、hooks 或本地凭据。

工具包位于：

```text
tools/claude-superpowers-kit/
├── template.md
├── install.mjs
├── verify.mjs
├── install.test.mjs
└── README.md
```

## 3. 规范模板

`template.md` 是唯一规范源，其自然语言使用中文，代码、命令、路径、API、标识符和必要技术术语保留英文。

模板必须包含以下约束：

1. 用户沟通以及 `docs/superpowers/specs/`、`docs/superpowers/plans/`、`.superpowers/sdd/` 中的规格、计划、任务简报和报告默认使用中文；即使上游 skill 提供英文模板，也只保留结构，必须本地化自然语言。
2. 长任务使用 `TaskCreate` / `TaskUpdate` 维护少量用户可见顶层任务，用户可通过 `/tasks` 查看。
3. 子代理内部实现步骤不得创建为顶层任务；顶层任务按用户可理解的成果划分。
4. 每完成一个顶层任务，主动播报 `进度 N/M`、结果和下一步；发生阻塞时同步说明阻塞点。
5. `.superpowers/sdd/progress.md` 仅作为会话压缩或恢复后的持久账本，不能替代 `/tasks` 和里程碑播报。
6. 每份新实施计划的“全局约束”重复关键语言和任务可见性规则，使隔离子代理能收到约束。
7. 遇到反复出现、可跨会话复用的规范缺口时，先向用户说明原因和拟新增规则；获批后写入项目 `CLAUDE.md`。一次性问题不沉淀为永久规则。
8. 不直接修改 `~/.claude/plugins/cache/` 中的 Superpowers 或其他第三方插件缓存；项目覆盖规则写入项目 `CLAUDE.md`，需要定制插件时使用独立 fork 或项目工具。

## 4. 托管区块

安装器只管理目标 `.claude/CLAUDE.md` 中的以下区块：

```markdown
<!-- claude-superpowers-kit:start -->
...template.md 内容...
<!-- claude-superpowers-kit:end -->
```

区块外内容必须逐字保留。安装器不得重排、格式化或删除目标项目原有内容。

## 5. 安装行为

命令：

```bash
node tools/claude-superpowers-kit/install.mjs /absolute/or/relative/target-project
```

行为：

- 目标参数省略时，以当前工作目录作为目标项目。
- 目标不存在或不是目录时，输出明确错误并以非零状态退出。
- 目标没有 `.claude/` 时创建目录。
- 目标没有 `.claude/CLAUDE.md` 时创建文件并写入托管区块。
- 已有文件但没有标记时，在文件末尾追加一个空行和托管区块，保留原内容。
- 已有且完整的标记区块时，仅原位替换区块内容。
- 仅存在一个标记、标记重复或结束标记早于开始标记时，安全失败，不写文件。
- 重复执行相同版本时，文件内容保持完全不变。
- 安装成功后打印目标文件路径和 `verify.mjs` 命令。

安装器从 `import.meta.url` 定位同目录 `template.md`，因此可从任意工作目录执行。

## 6. 验证行为

命令：

```bash
node tools/claude-superpowers-kit/verify.mjs /target-project
```

验证器检查：

- `.claude/CLAUDE.md` 存在；
- 托管标记各出现一次且顺序正确；
- 托管区块内容与当前 `template.md` 完全一致；
- 关键规则关键词存在，包括 `/tasks`、`进度 N/M`、`.superpowers/sdd/progress.md`、中文本地化和插件缓存边界。

验证成功退出 0；失败列出具体原因并退出非零。验证器不修改文件。

## 7. 测试

`install.test.mjs` 使用 Node 标准库和临时目录，不引入测试框架。覆盖：

1. 空项目创建 `.claude/CLAUDE.md`。
2. 已有 CLAUDE.md 时保留原内容并追加区块。
3. 重复安装结果字节级不变。
4. 已有完整旧区块时原位更新且保留区块前后内容。
5. 单个标记、重复标记、反向标记均拒绝写入。
6. 安装后验证器成功。
7. 手工篡改区块后验证器失败。
8. 从非工具包目录执行时仍能找到模板。

为便于测试，`install.mjs` 和 `verify.mjs` 将纯逻辑导出为函数，并使用 `fileURLToPath(import.meta.url)` 保护 CLI 入口。

## 8. README

README 使用中文说明：

- 工具包解决的问题和适用范围；
- 复制整个目录到其他仓库后的单命令安装方式；
- 安装、升级、验证和手工卸载方法；
- 安装器只管理标记区块，不覆盖已有规则；
- 推荐用户通过 `/tasks` 查看当前顶层任务；
- 可选的用户级 Claude Code 设置：`{"language":"chinese"}`，但强调它只是默认响应语言，不能替代项目规则；
- 新会话通过 `/memory` 检查项目 `CLAUDE.md` 是否加载；
- 不直接修改第三方插件缓存的原因。

## 9. 错误处理与安全边界

- 所有路径通过 Node `path.resolve` 解析。
- 不使用 `shell: true`，不执行目标项目代码。
- 写入前完整验证标记状态。
- 更新文件采用同目录临时文件后原子替换，避免中断留下半个区块。
- 文件写入保持 UTF-8。
- 不访问用户级 `~/.claude/settings.json`，不修改目标项目 settings、hooks 或 skills。
- 不自动提交目标项目。

## 10. 完成标准

满足以下条件才可声明完成：

- 五个工具包文件齐全且自然语言为中文；
- 安装器在新项目和已有项目中均正确工作；
- 重复安装幂等；
- 损坏标记时拒绝覆盖；
- 验证器能识别正确安装和内容漂移；
- 所有 Node 测试、ESLint、Prettier 与 `git diff --check` 通过；
- 用一个独立临时项目执行真实安装和验证成功；
- 当前仓库原有 `CLAUDE.md` 内容不被工具包测试修改；
- 未创建 Git commit。
