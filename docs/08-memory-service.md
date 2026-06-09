# PRD §14：项目记忆服务设计

> 对应原 PRD.md 第 14 节。

---

## §14.1 记忆服务目标

记忆服务要解决：

```text
项目事实跨会话遗忘
旧记忆污染
记忆不可审计
记忆无法按项目隔离
召回只返回碎片，不返回项目画像
```

## §14.2 Memory API 思路

必须同时支持 `remember`、`recall`、`forget`、`list`。不能只做 `save memory`，因为项目事实会变化，只能写入不能遗忘会污染 Agent。

## §14.3 MemoryRecord 类型

支持类型及其说明：

| 类型 | 说明 |
|------|------|
| decision | 长期设计决策 |
| bug | 历史 bug 或当前 bug |
| command | 有意义的命令结果 |
| file_summary | 文件摘要 |
| project_rule | 项目规则 |
| user_preference | 用户偏好 |
| current_task | 当前任务状态 |
| test_failure | 测试失败信息 |
| api_contract | 接口契约 |
| dependency | 依赖、包管理器、版本相关信息 |

## §14.4 Memory lifecycle

**状态**：`active` → `superseded` / `forgotten` / `expired`

**规则**：
- active 默认参与 recall
- superseded / forgotten / expired 默认不参与 recall
- list_context 可查看非 active 记忆

## §14.5 repo_profile.static

保存长期稳定事实：

```text
技术栈
架构约束
包管理器
重要设计决策
项目长期规则
不能随便改的约定
API contract
dependency policy
```

示例：

```text
本项目使用 pnpm。
API client 必须通过 src/lib/api.ts 调用。
不要修改 generated files。
```

## §14.6 repo_profile.dynamic

保存近期上下文：

```text
当前正在修的模块
最近失败的测试
最近排查的问题
本轮任务临时状态
最近修改过的关键文件
最近压缩过的重要日志
```

示例：

```text
当前正在修 auth/session.ts 的 refresh token cookie 清理问题。
最近 pnpm test 在 auth/session.test.ts 失败。
```

## §14.7 recall_context 返回结构

recall 不应只是简单搜索几条 memory，应返回：

```text
repo_profile.static
repo_profile.dynamic
top-k relevant memories
related compressed contexts
sourceRef
confidence
canExpand
retrieval_receipt
```
