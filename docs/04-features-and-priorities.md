# PRD §8–9：功能优先级与吸收策略

> 对应原 PRD.md 第 8–9 节。

---

## §8. 功能优先级

### §8.1 P0：压缩基础设施，也是记忆服务基础设施

P0 必须做：

```text
MCP Server
current_scope
ContentRouter
compress_context
retrieve_original
CompressedContextRecord
OriginalContentStore
compression_receipt
token_stats
timeout
size limit
chunking
fail-open
SQLite storage
CLI basic commands
```

说明：这些能力虽然以压缩为先，但也是后续记忆服务的基础 — scopeId 可复用于 memory、receipt 可复用于 retrieval、sourceRef 可关联 originalRef、compressed records 可转为 memory。

### §8.2 P1：项目记忆服务闭环

P1 必须做：

```text
remember_context
recall_context
forget_context
list_context
MemoryRecord
Memory lifecycle
repo_profile.static
repo_profile.dynamic
retrieval_receipt
SQLite FTS5 / BM25 recall
sourceRef / originalRef / ccrId 关联
```

说明：P1 不是可有可无的锦上添花，而是产品第二核心。

### §8.3 P2：压缩与记忆融合增强

P2 可做：

```text
save_compression_as_memory
recall_context 返回相关 compressed contexts
recall_context 返回 static + dynamic + top-k memories + related ccr
list_context 支持 memory + compressed contexts 混合审计
forget_context 可同时处理 memory 和 cached context
compression strategy config
list_compressions
get_receipt
cleanup_originals
```

### §8.4 P3：智能化与扩展

P3 可做：

```text
CacheAligner
IntelligentContext
headroom_read
Failure learning
TOIN 学习
embedding search
hybrid retrieval
reranker
minimal dashboard
SDK
editor extension
```

### §8.5 第一版不建议做

```text
透明 HTTP proxy
WebSocket provider interception
多 provider auth
ML 模型压缩文本
图像压缩
云同步
OAuth
Gmail / Notion / Drive 连接器
复杂 UI
多用户权限系统
自动改 CLAUDE.md / AGENTS.md
```

---

## §9. 必须吸收 / 后续吸收 / 不建议吸收

### §9.1 必须吸收

1. **ContentRouter** — 先识别内容类型，再选择压缩策略
2. **CCR + retrieve_original** — 每次压缩生成记录，原文保存到 OriginalContentStore
3. **安全兜底** — 压缩失败返回原文，不影响 Agent，receipt 记录失败原因
4. **统计能力** — tokens saved、压缩次数、retrieve 次数、recall 次数、forget 次数、failure 次数
5. **保守代码压缩** — 不改写语义，不删除 public API / 类型定义 / 错误相关行
6. **按需 MCP 工具** — 第一版通过 MCP tools 显式调用，不做透明代理
7. **大输入保护** — timeout、size limit、chunking、fail-open

### §9.2 可以后续吸收

- **CacheAligner** — 重复输入缓存，不放第一版（需 content hash、策略版本、cache invalidation）
- **IntelligentContext** — 结合会话历史决定是否压缩，MVP 可不做
- **TOIN 学习** — 第一版数据不足，效果难验证
- **headroom_read** — 可以借鉴，但不要默认替代用户的 Read 工具
- **Failure learning** — 第一版只记录失败 / 高 retrieveCount / 被 forget 的记忆，不学习

### §9.3 不建议第一版吸收

```text
透明 HTTP proxy
WebSocket provider interception
多 provider auth 适配
ML 模型压缩文本
图像压缩
自动改 CLAUDE.md / AGENTS.md
```

原因：与 MVP 核心闭环关系弱，开发成本高，稳定性风险高，安全风险高，容易导致项目失控。
