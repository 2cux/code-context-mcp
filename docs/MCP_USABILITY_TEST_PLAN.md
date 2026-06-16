# MCP Usability Test Plan

> 人工可执行的 Agent 使用测试，比较三种工具暴露模式的 Agent 行为差异。
>
> 基于 `docs/TOOL_INVENTORY.md` 和 `docs/TOOL_SURFACE_DECISION_MATRIX.md` 的分类。

---

## 测试目标

1. 量化"工具选择错误"在不同模式下的频率
2. 评估 `run_context_flow` 是否减少了 Agent 的工具选择负担
3. 发现工具命名、描述或返回格式的可用性问题

---

## 三种测试模式

### Mode A: Full Tool Mode（17+ 工具全部可见）

Agent 可见 CodeContext MCP 的全部 18 个工具：

```
current_scope, compress_context, retrieve_original, delete_original,
cleanup_originals, list_compressions, remember_context, recall_context,
forget_context, list_context, analyze_context, list_failures, failure_stats,
list_harness_flows, run_harness_flow, get_harness_run, check_harness_flow,
run_context_flow
```

### Mode B: Agent Mode（9 个推荐工具）

仅暴露 `TOOL_SURFACE_DECISION_MATRIX.md` 中标记为 `Surface` 的工具：

```
current_scope, compress_context, retrieve_original, list_compressions,
remember_context, recall_context, forget_context, list_context,
analyze_context
```

### Mode C: Agent Mode + run_context_flow（3 个工具）

极度精简——只暴露统一入口：

```
current_scope, compress_context, run_context_flow
```

注：`current_scope` 和 `compress_context` 保留是因为 `run_context_flow` 内部使用它们，Agent 也需要在特定场景直接调用。

---

## 测试场景

基于 `fixtures/mcp-eval/agent-usability/scenarios.json` 的 5 个场景：

| ID | 场景 | 用户输入 | 期望工具 |
|----|------|----------|----------|
| U01 | 长测试日志压缩 | "这是一段很长的 pnpm test 输出，请帮我找出失败原因，必要时保存关键失败信息。" | compress_context, retrieve_original, remember_context OR run_context_flow |
| U02 | 构建失败分析 | "这段 build 输出太长，帮我压缩成可行动摘要。" | compress_context OR run_context_flow |
| U03 | 保存并召回项目规则 | "记住：本项目使用 pnpm，不要用 npm。随后帮我安装 zod。" | remember_context, recall_context OR run_context_flow |
| U04 | 替换旧记忆 | "之前说用 npm 是错的，现在统一改成 pnpm，并且旧规则以后不要再召回。" | remember_context, forget_context, recall_context OR run_context_flow |
| U05 | 大代码文件保守压缩 | "压缩这个大 TypeScript 文件，保留 public API、类型定义、错误相关代码块。" | compress_context OR run_context_flow |

### 输入文件

从 `fixtures/mcp-eval/performance/` 加载：
- U01: `test-output-100kb.log`
- U02: `build-output-failure-100kb.log`
- U05: `../content/large-typescript-file.ts`

---

## 测试执行流程

### 每个模式 × 每个场景执行以下步骤：

1. **准备**：配置 Agent 的 MCP tool list（仅暴露该模式允许的工具）
2. **执行**：向 Agent 发送用户输入，观察 Agent 的工具调用
3. **记录**：填写报告模板（见 `docs/MCP_USABILITY_REPORT_TEMPLATE.md`）
4. **评分**：对每次执行打分

### 最少执行次数

```
5 scenarios × 3 modes = 15 次测试
```

建议每个模式每个场景至少执行 2 次（总计 30 次），以减少单次试验偏差。

---

## 评价指标

| 指标 | 定义 | 记录方式 |
|------|------|----------|
| **Tool Calls Count** | Agent 在本次对话中总共调用了多少次 MCP 工具 | 计数 |
| **Wrong Tool Calls** | 调用了不合适的工具（如应该 recall 却调了 list_context） | 计数 + 标注工具名 |
| **Repeated Tool Calls** | 对同一操作重复调用多次（如连续 3 次 compress_context） | 计数 |
| **Dangerous Tool Calls** | 调用了危险工具（delete_original, cleanup_originals 等） | 计数 + 标注工具名 |
| **Need User Correction** | 用户需要介入纠正 Agent 的行为 | 是/否 |
| **Task Completed** | 任务目标是否达成 | 是/否 |
| **Result Quality (1-5)** | 1=完全错误，3=基本可用，5=超出预期 | 评分 |
| **Latency Observed** | 从用户发出指令到 Agent 完成的时间（大致感知） | 秒数 |
| **Notes** | 任何值得记录的观察 | 自由文本 |

### 计分规则

- 每场景基础分 = Result Quality × 2（满分 10）
- 扣分项：每 Wrong Tool Call -1，每 Repeated Call -0.5，每 Dangerous Call -2
- 最终得分 = max(0, 基础分 - 扣分)
- 模式总分 = 该模式下所有场景得分之和 / 场景数

---

## 成功标准

| 标准 | 阈值 |
|------|------|
| Agent Mode 得分 > Full Mode 得分 | 确认精简工具集减少错误 |
| Agent Mode + run_context_flow 得分 ≥ Agent Mode 得分 | 确认统一入口有帮助 |
| Full Mode 中 Dangerous Tool Calls = 0 | 确认 Agent 不会误调用危险工具 |
| 每个模式 Task Completed 率 ≥ 80% | 确认基本功能可用 |

---

## 输出

测试结果记录在 `reports/usability/` 目录：

```
reports/usability/
  mode-a-full.md       ← Full Mode 测试结果
  mode-b-agent.md      ← Agent Mode 测试结果
  mode-c-flow.md       ← Agent Mode + run_context_flow 测试结果
  summary.md           ← 三模式对比总结
```

使用 `docs/MCP_USABILITY_REPORT_TEMPLATE.md` 模板填写。
