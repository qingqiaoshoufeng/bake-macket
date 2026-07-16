# Claude Code + Superpowers 可迁移规范包

该工具包用于把通用的 Claude Code + Superpowers 协作规则安装到其他项目，重点解决：

- Superpowers 英文模板导致规格、计划或报告意外使用英文；
- 长任务缺少用户可见进度；
- 子代理内部步骤污染 `/tasks` 顶层任务列表；
- `.superpowers/sdd/progress.md` 被误当作用户进度界面；
- 已发现的协作规范没有沉淀，后续会话重复犯错。

工具包只迁移通用协作规则，不复制 bake-mall 的业务、技术栈、hooks、项目技能或本地凭据。

## 一键安装

将整个 `tools/claude-superpowers-kit/` 目录复制到目标仓库，然后在工具包所在仓库执行：

```bash
node tools/claude-superpowers-kit/install.mjs /path/to/target-project
```

省略目标路径时，安装到当前工作目录：

```bash
node tools/claude-superpowers-kit/install.mjs
```

安装器会创建或更新目标项目的 `.claude/CLAUDE.md`。它只管理以下标记区块：

```markdown
<!-- claude-superpowers-kit:start -->
<!-- 工具包规则 -->
<!-- claude-superpowers-kit:end -->
```

区块外的项目规则会逐字保留。重复执行安装命令是幂等的，也可用于将目标项目升级到最新模板。

## 验证

```bash
node tools/claude-superpowers-kit/verify.mjs /path/to/target-project
```

验证器只读检查标记、模板内容和关键规则，不修改目标项目。

## 用户如何查看任务进度

- 在 Claude Code 中使用 `/tasks` 查看当前少量顶层任务。
- Claude 每完成一个顶层任务应主动播报 `进度 N/M`、结果和下一步。
- 子代理内部测试、实现和审查步骤不应出现在顶层任务列表。
- `.superpowers/sdd/progress.md` 是会话压缩后的恢复账本，不是用户进度界面。

## 升级与卸载

升级：替换工具包目录后重新执行安装和验证命令。

卸载：从目标 `.claude/CLAUDE.md` 中删除起止标记及其内部内容。不要删除区块外的项目规则。

如果标记缺失、重复或顺序损坏，安装器会安全失败，不会猜测或覆盖文件。先手工修复标记，再重新安装。

## 可选的用户级语言偏好

Claude Code 可选择设置默认响应语言：

```json
{
  "language": "chinese"
}
```

该设置适合放在用户级 `~/.claude/settings.json`，但它只是默认响应语言，不能代替项目 `.claude/CLAUDE.md` 对规格、计划、报告和子代理的明确约束。本工具包不会自动修改用户级设置。

## 验证 Claude 是否加载规则

安装后建议新开 Claude Code 会话，并使用 `/memory` 检查目标项目的 `.claude/CLAUDE.md` 是否已加载。

## 为什么不修改 Superpowers 插件缓存

不要直接修改 `~/.claude/plugins/cache/`：

- 插件升级会切换版本目录并覆盖本地修改；
- 缓存修改难以随项目共享和审查；
- 不同项目可能需要不同规则。

项目级覆盖应写入项目 `CLAUDE.md`；确需定制插件时，应维护独立 fork 或项目工具，而不是编辑缓存。

## 本工具包自测

在当前仓库中运行：

```bash
pnpm test:claude-superpowers-kit
pnpm verify:claude-superpowers-kit
```
