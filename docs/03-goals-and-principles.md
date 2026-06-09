# PRD §5–7：可行性分析、产品目标与设计原则

> 对应原 PRD.md 第 5–7 节。

---

## §5. 需求真实性与可行性判断

### §5.1 需求真实性：高

原因：

```text
AI Coding Agent 的上下文窗口有限
日志、测试输出、代码文件过长是高频问题
跨会话遗忘项目规则是高频问题
项目事实会变化，必须支持遗忘和替换
多项目开发确实需要 scope 隔离
压缩和召回都需要可审计，否则用户不信任
```

### §5.2 技术可实现性：中高

可实现部分：

```text
MCP Server
ContentRouter
规则压缩
原文缓存
retrieve_original
token 统计
SQLite 存储
compression receipt
retrieval receipt
repo scope resolver
remember / recall / forget / list
SQLite FTS5 / BM25 检索
memory lifecycle
repo_profile.static / dynamic
timeout / size limit / chunking / fail-open
```

难点：

```text
高质量代码语义压缩
自动判断哪些内容值得长期记忆
自动识别旧记忆是否过期
高质量语义召回
透明代理所有模型请求
多 provider auth 和 streaming 兼容
```

因此第一版应使用：

```text
显式 MCP tools
保守压缩
本地 SQLite
简单检索
人工或 Agent 显式 remember / forget
```

### §5.3 项目复杂度：中偏高

可控版本（做）：

```text
MCP tools
本地 SQLite
规则压缩
原文缓存
FTS5 检索
receipt
CLI demo
```

失控版本（砍掉）：

```text
透明代理
WebSocket interception
云同步
多 provider auth
复杂 UI
全自动记忆学习
ML 压缩
多模态处理
```

### §5.4 差异化潜力：高

普通压缩工具的问题：只压缩，不知道项目上下文；压缩后原文不可恢复；没有 scope 隔离；没有长期记忆；没有 recall / forget。

普通记忆工具的问题：只记忆，不解决上下文过长；容易堆积旧信息；没有压缩统计；不能处理工具输出和日志。

本项目的差异化：

```text
把上下文压缩和项目记忆结合
压缩后可 retrieve 原文
记忆可 recall / forget / list
所有操作有 receipt
按 repo scope 隔离
面向 coding agent，而不是通用个人知识库
第一版用 MCP tools，避免重型代理
```

### §5.5 当前是否值得继续推进

结论：值得继续推进，但必须采用"双核心产品定位 + 分阶段开发顺序"。产品上压缩和记忆同等重要；开发上先实现压缩，再实现记忆。

---

## §6. 产品目标

### §6.1 总体目标

构建一个可被 AI Coding Agent 调用的本地上下文服务层，使 Agent 能够：

```text
压缩过长上下文
在需要时取回原文
知道压缩节省了多少 token
保存重要项目事实
召回相关项目记忆
遗忘过期或错误记忆
按 repo 隔离上下文
审计每次压缩和召回行为
```

### §6.2 MVP 目标

MVP 阶段不要求两个子系统都完整成熟，但架构上必须同时容纳二者。

MVP 至少完成：

```text
current_scope
compress_context
retrieve_original
compression_receipt
token_stats
ContentRouter
OriginalContentStore
CompressedContextRecord
timeout / size limit / chunking / fail-open
```

并为记忆服务预留：

```text
MemoryRecord schema
Receipt schema
scopeId 关联
sourceRef 关联 originalRef / ccrId
```

### §6.3 V1 目标

V1 完成项目记忆服务闭环：

```text
remember_context
recall_context
forget_context
list_context
repo_profile.static
repo_profile.dynamic
retrieval_receipt
memory lifecycle
SQLite FTS5 recall
```

### §6.4 V2 目标

V2 做智能化增强：

```text
CacheAligner
IntelligentContext
headroom_read
Failure learning
TOIN 学习
hybrid retrieval
embedding search
压缩策略优化
memory 自动建议
```

---

## §7. 核心设计原则

### §7.1 双核心原则

本项目有两个同等重要的核心：上下文压缩和项目记忆。

正确关系是：

```text
压缩解决"上下文太长"
记忆解决"上下文会忘、会过期、会污染"
scope 解决"项目隔离"
receipt 解决"可证明、可审计"
originalRef 解决"可恢复"
profile 解决"长期事实 + 近期任务"
```

### §7.2 开发顺序原则

先压缩上下文，再记忆服务。原因：压缩闭环更容易独立验证，测试日志和工具输出是高频刚需，压缩收益可用 token saved 直接证明。

### §7.3 ContentRouter 必须吸收

必须先识别内容类型，再选择压缩策略。支持内容类型：test_output、log、command_output、code、json、markdown、plain_text、rag_chunk、file_summary、conversation_history、unknown。

### §7.4 CCR 必须吸收

Compressed Context Record。每次压缩必须生成 CCR，包含 compressedContent、originalRef、contentType、strategy、tokensBefore/tokensAfter/tokensSaved、canRetrieveOriginal、sourceRef、scopeId、receiptId。

### §7.5 压缩后必须能 retrieve 原文

压缩不能是不可逆黑箱。必须支持 `retrieve_original(originalRef)`。

### §7.6 安全兜底必须吸收

压缩失败时必须返回原文，不阻断 Agent，不返回空或损坏内容，记录 failed=true 和 errorReason，生成 receipt。

### §7.7 统计能力必须吸收

必须统计 tokensBefore、tokensAfter、tokensSaved、compressionRatio、compressedCount、retrieveCount、recallCount、memoryCount、forgetCount、failureCount。

### §7.8 代码压缩必须保守

必须保留 file path、imports、exports、type/interface、function signature、class signature、public API、TODO/FIXME、行号。禁止改写代码逻辑、删除 public API/类型定义/错误相关行。

### §7.9 按需 MCP 工具优先

第一版采用 MCP tools，而不是透明代理。开发成本低、集成简单、失败影响小。

### §7.10 大输入保护必须吸收

必须支持 timeout、size limit、chunking、fail-open。

### §7.11 记忆必须可调用、可召回、可遗忘、可隔离、可审计

必须吸收：remember_context、recall_context、forget_context、list_context、current_scope、repo_profile.static/dynamic、retrieval_receipt。不能只是生成 MEMORY.md。
