# CodeContext MCP — PRD 索引

> **Release Status**
> - `v1.0.0` — Context Compression + Project Memory (current, stable)
> - `v0.2.0-beta` — Context Compression + Project Memory
> - `v0.1.0-alpha` — Context Compression only
>
> Stable release: 18 MCP tools across agent (7) / dev (18) / test (18) modes. ~1600 tests passing. CLI with `doctor`, `demo`, `value`, and 20+ commands.

> 本文档索引了 `docs/` 下所有 PRD 分篇文件，每篇对应原 PRD.md 的若干连续章节。

| # | 文件 | 原章节 | 内容概要 |
|---|------|--------|----------|
| 1 | [01-overview.md](./01-overview.md) | §0–1 | 项目命名（推荐名、备选）、文档信息（技术栈、目标阶段、第一版范围） |
| 2 | [02-background-and-positioning.md](./02-background-and-positioning.md) | §2–4 | 产品背景（上下文太长 + 跨会话遗忘）、产品定位（双核心）、目标用户（4 类用户） |
| 3 | [03-goals-and-principles.md](./03-goals-and-principles.md) | §5–7 | 需求可行性判断、产品目标（MVP/V1/V2）、11 条核心设计原则 |
| 4 | [04-features-and-priorities.md](./04-features-and-priorities.md) | §8–9 | P0–P3 功能优先级、必须吸收 / 后续吸收 / 不建议吸收清单 |
| 5 | [05-user-scenarios.md](./05-user-scenarios.md) | §10 | 8 个核心用户场景：压缩日志、压缩代码、压缩 RAG、保存规则、替换记忆、继续任务、审计、scope 隔离 |
| 6 | [06-mcp-tool-design.md](./06-mcp-tool-design.md) | §11 | 9 个 MCP Tool 的输入/输出/规则/验收标准：current_scope、compress_context、retrieve_original、get_receipt、list_compressions、remember_context、recall_context、forget_context、list_context |
| 7 | [07-content-router-and-compression.md](./07-content-router-and-compression.md) | §12–13 | ContentRouter 类型识别规则 + 9 种压缩策略（test_output、log、command_output、code、json、markdown、rag_chunk、conversation_history） |
| 8 | [08-memory-service.md](./08-memory-service.md) | §14 | 项目记忆服务设计：Memory API、MemoryRecord 类型、生命周期、repo_profile.static / dynamic |
| 9 | [09-data-model-and-schema.md](./09-data-model-and-schema.md) | §15–17 | 6 种数据模型（ScopeRecord、CCR、OriginalContent、MemoryRecord、RepoProfile、Receipt）+ 7 张 SQLite 表 + 本地存储结构 |
| 10 | [10-config-security-and-errors.md](./10-config-security-and-errors.md) | §18–20 | 配置项列表、安全与隐私（本地优先、API key、原文缓存风险、scope 隔离）、5 种错误处理场景 |
| 11 | [11-performance-cli-and-development.md](./11-performance-cli-and-development.md) | §21–23 | 性能目标表、CLI 命令设计、8 个开发阶段规划（Phase 0–7） |
| 12 | [12-verification-demo-and-architecture.md](./12-verification-demo-and-architecture.md) | §24–28 | MVP 验收用例（7 个）、READEME 演示场景（5 个）、技术架构图、模块职责、目录结构、文档要求 |
| 13 | [13-success-criteria-risks-and-conclusion.md](./13-success-criteria-risks-and-conclusion.md) | §29–33 | 4 类成功标准（MVP/V1/用户价值/作品集）、5 类风险分析、不做清单、最小可验证版本、最终结论 |
| 14 | [14-harness.md](./14-harness.md) | §34 | CodeContext Harness：统一业务闭环执行框架，Manifest + Run + Run Receipt，第一版定位与设计约束 |
| 15 | [project-context-resources.md](./project-context-resources.md) | – | MCP Resources & Prompts：project-profile、project-stats、project_context_brief 的设计与输出结构 |

---

**快速导航建议：**

- 想快速了解项目全貌 → [01-overview.md](./01-overview.md)
- 想理解为什么要做双核心 → [02-background-and-positioning.md](./02-background-and-positioning.md)
- 想看具体 MCP 工具长什么样 → [06-mcp-tool-design.md](./06-mcp-tool-design.md)
- 想看数据模型和表结构 → [09-data-model-and-schema.md](./09-data-model-and-schema.md)
- 想看开发路线图 → [11-performance-cli-and-development.md](./11-performance-cli-and-development.md)
- 想了解 MCP Resource/Prompt 设计 → [project-context-resources.md](./project-context-resources.md)
