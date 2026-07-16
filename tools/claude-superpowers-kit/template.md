## Claude Code + Superpowers 协作规范

- 用户沟通以及 `docs/superpowers/specs/`、`docs/superpowers/plans/`、`.superpowers/sdd/` 中的规格、计划、任务简报和报告默认使用中文；代码、命令、路径、API、标识符及必要技术术语保留英文。即使上游 skill 提供英文模板，也必须保留结构并将自然语言本地化为中文。
- 长任务使用 `TaskCreate` / `TaskUpdate` 维护少量用户可见的顶层任务，用户可通过 `/tasks` 查看；顶层任务按用户可理解的成果划分，子代理内部实现步骤不得创建为顶层任务。
- 每完成一个顶层任务，主动播报 `进度 N/M`、当前结果和下一步；发生阻塞时立即说明阻塞点，并将当前任务恢复为 pending/open，避免任务长期停留在 in_progress。
- `.superpowers/sdd/progress.md` 只用于会话压缩或恢复后的持久账本，不能替代 `/tasks` 和里程碑播报。
- 每份新实施计划的“全局约束”必须重复关键语言与任务可见性规则，确保隔离子代理收到约束。
- 遇到反复出现且可跨会话复用的规范缺口时，先向用户说明原因和拟新增规则；用户批准后再沉淀到项目 `CLAUDE.md`。一次性问题不写成永久规则。
- 不直接修改 `~/.claude/plugins/cache/` 中的 Superpowers 或其他第三方插件缓存；项目覆盖规则写入项目 `CLAUDE.md`，需要定制插件时使用独立 fork 或项目工具。
