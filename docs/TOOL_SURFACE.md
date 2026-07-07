# MCP Tool Surface Configuration

> CodeContext MCP 工具暴露策略 — 基于 `reports/usability/agent-usability-report.json` 可用性评估结果。

---

## 三种模式

| 模式 | 工具数 | 默认 | 描述 |
|------|--------|------|------|
| **agent** | 7 | ✅ 默认 | AI 编码 Agent 的安全最小表面 |
| **dev** | 18 | — | 开发者完整访问（含危险工具） |
| **test** | 18 | — | 完整 schema/smoke/harness 测试 |

设置方式: 环境变量 `MCP_TOOL_MODE=agent|dev|test`

---

## Agent Mode (7 tools)

```
current_scope       — 解析项目 scope (前置依赖)
compress_context     — 压缩长上下文 (核心能力 #1)
retrieve_original    — 恢复原始内容
remember_context     — 保存项目记忆 (核心能力 #2)
recall_context       — 检索项目记忆 + profile
forget_context       — 管理记忆生命周期
run_context_flow     — 统一入口 (compression/memory/full)
```

**排除**: harness 工具 (4)、危险工具 (2)、浏览/审计工具 (4)、failure 分析 (2)

**评分**: 可用性评估 95% — 12 个场景中 10 个满分

---

## Dev Mode (18 tools)

全部 18 个已注册 MCP tool — 开发者完整访问。
Agent 模式 7 个 + 以下 11 个:

```
list_context         — 记忆审计浏览
list_compressions    — 压缩历史浏览
analyze_context      — 决策辅助分析
list_failures        — 失败事件列表
failure_stats        — 失败统计
list_harness_flows   — Harness flow 发现
run_harness_flow     — Harness flow 执行
get_harness_run      — Harness 运行状态
check_harness_flow   — Harness manifest 验证
delete_original      — 删除原始内容 (开发者维护)
cleanup_originals    — 批量清理过期原始内容 (开发者维护)
```

---

## Test Mode (18 tools)

全部 18 个已注册 MCP tool — 用于 CI schema 校验、smoke test、harness test。

**包含**: 全部 18 个已注册工具，与 Dev 模式相同

---

## 危险工具

以下工具**不在 agent 模式中出现，但包含在 dev/test 模式中供开发者维护使用**:

| 工具 | 风险 | 模式 |
|------|------|------|
| `delete_original` | 不可逆删除原始内容 | dev/test only |
| `cleanup_originals` | 批量删除过期原始内容 | dev/test only |

---

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-06-16 | 初始版本 — 基于 usability evaluation 结果 (95% agent mode score) |
