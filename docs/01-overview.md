# PRD §0–1：项目概览

> 对应原 PRD.md 第 0–1 节。

---

## §0. 项目命名

### 推荐项目名

```text
CodeContext MCP
```

### 推荐 GitHub 仓库名

```text
code-context-mcp
```

### 命名理由

相比 `ContextMemory MCP`、`ContextZip MCP`、`RepoMemory MCP`，`CodeContext MCP` 更适合作为 GitHub 项目名，原因是：

```text
1. 包含 code，明确面向编码场景
2. 包含 context，覆盖上下文压缩和上下文记忆
3. 包含 mcp，方便被 MCP 相关搜索命中
4. 不会把项目误解为单纯 memory 项目
5. 不会把项目误解为单纯 compression 项目
6. 更适合 GitHub、npm、README、搜索关键词和作品集展示
```

### 备选名称

```text
code-context-mcp
agent-context-mcp
mcp-code-context
code-context-layer
agent-code-context
repo-context-mcp
```

最终推荐：

```text
code-context-mcp
```

---

## §1. 文档信息

| 字段 | 内容 |
|------|------|
| 产品名称 | CodeContext MCP |
| GitHub 仓库名 | `code-context-mcp` |
| 产品类型 | MCP Server / 本地上下文服务层 / AI Coding Agent 辅助工具 |
| 核心能力 | 上下文压缩 + 项目记忆服务 |
| 产品原则 | 上下文压缩和项目记忆同等重要 |
| 开发顺序 | 先做上下文压缩，再做项目记忆服务 |
| 目标阶段 | MVP → 作品集项目 → 可扩展开发者工具 |
| 目标用户 | 高频使用 AI Coding Agent 的开发者 |
| 主要客户端 | Claude Code、Cursor、OpenCode、Codex CLI、Aider 或其他支持 MCP 的编码 Agent |
| 推荐技术栈 | TypeScript / Node.js / SQLite / SQLite FTS5 |
| 默认存储 | 本地 SQLite + 本地原文缓存 |
| 第一版形态 | MCP tools + CLI 调试工具 |
| 第一版不做 | 透明 HTTP proxy、WebSocket provider interception、多 provider auth、云同步、复杂 UI、ML 模型压缩、图像压缩、自动改 CLAUDE.md / AGENTS.md |
