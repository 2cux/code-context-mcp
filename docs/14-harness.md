# PRD §34：Harness

> CodeContext MCP 内置的统一业务闭环执行框架。

---

## 目标

Harness 用来统一执行以下闭环：

- 压缩闭环
- 原文取回 / 删除闭环
- 记忆保存 / 召回 / 遗忘闭环
- profile 闭环
- receipt / run receipt 审计闭环
- CLI 验收
- MCP tools 验收
- 完整压缩 + 记忆验收

---

## 第一版定位

### 代码位置

```
src/harness/
```

### 设计约束

- **CodeContext 专用** — 不做通用 workflow engine
- **业务能力级 Manifest** — Manifest 声明要执行哪个闭环，不声明具体工具调用序列
- **runs/ 落盘** — Run 执行记录持久化到 `runs/` 目录
- **receipt 升级为 run receipt** — run receipt 覆盖整个闭环执行，引用子 receipt，不替代现有单操作 receipt
- **CLI + MCP 暴露** — 提供 `code-context harness *` CLI 命令组和 `harness_*` MCP tools
- **checkpoint 只记录，不阻塞** — checkpoint 是审计日志条目，不是断点，不中断执行
- **暂不做 ProviderRegistry** — 第一版不抽象 AI provider
