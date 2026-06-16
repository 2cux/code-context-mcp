# Usability Test Reports

> CodeContext MCP Agent 可用性测试结果存放目录。
>
> 测试计划: `docs/MCP_USABILITY_TEST_PLAN.md`
> 报告模板: `docs/MCP_USABILITY_REPORT_TEMPLATE.md`

---

## 如何执行测试

### 1. 准备

```bash
# 确认项目已构建
pnpm build

# 确认 MCP server 可启动
node dist/index.js
```

### 2. 配置 Agent

在 Claude Desktop 或其他 MCP 客户端中，按模式配置可见工具：

**Mode A (Full):** 不限制，暴露全部 18 个工具。

**Mode B (Agent):** 仅暴露 9 个：
```
current_scope, compress_context, retrieve_original, list_compressions,
remember_context, recall_context, forget_context, list_context, analyze_context
```

**Mode C (Agent+Flow):** 仅暴露 3 个入口：
```
current_scope, compress_context, run_context_flow
```

### 3. 执行

对于每个模式和每个场景：

1. 复制 `docs/MCP_USABILITY_REPORT_TEMPLATE.md` 到 `reports/usability/mode-{X}-{name}.md`
2. 在 Agent 对话中发送场景输入
3. 观察并记录工具调用
4. 填写报告模板

### 4. 总结

合并三个模式的报告到 `reports/usability/summary.md`。

---

## 文件结构

```
reports/usability/
  README.md             ← 本文件
  mode-a-full.md        ← Full Mode 测试结果
  mode-b-agent.md       ← Agent Mode 测试结果
  mode-c-flow.md        ← Agent+Flow Mode 测试结果
  summary.md            ← 三模式对比总结
```

---

## 预期结果（假设）

| 模式 | 预期得分 | 预期工具选择错误 | 预期完成率 |
|------|---------|-----------------|-----------|
| Full (17 tools) | 较低 | Agent 被 17 个工具迷惑，可能选错 | ~70% |
| Agent (9 tools) | 中高 | 工具集精简但仍有混淆 (analyze vs recall) | ~90% |
| Agent+Flow (3 tools) | 最高 | run_context_flow 覆盖大部分场景 | ~95% |
