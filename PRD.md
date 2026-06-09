# PRD：CodeContext MCP —— 面向 AI Coding Agent 的本地上下文压缩与项目记忆服务层

## 0. 项目命名

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

## 1. 文档信息

| 字段         | 内容                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| 产品名称       | CodeContext MCP                                                                                                |
| GitHub 仓库名 | `code-context-mcp`                                                                                             |
| 产品类型       | MCP Server / 本地上下文服务层 / AI Coding Agent 辅助工具                                                                   |
| 核心能力       | 上下文压缩 + 项目记忆服务                                                                                                 |
| 产品原则       | 上下文压缩和项目记忆同等重要                                                                                                 |
| 开发顺序       | 先做上下文压缩，再做项目记忆服务                                                                                               |
| 目标阶段       | MVP → 作品集项目 → 可扩展开发者工具                                                                                         |
| 目标用户       | 高频使用 AI Coding Agent 的开发者                                                                                      |
| 主要客户端      | Claude Code、Cursor、OpenCode、Codex CLI、Aider 或其他支持 MCP 的编码 Agent                                                |
| 推荐技术栈      | TypeScript / Node.js / SQLite / SQLite FTS5                                                                    |
| 默认存储       | 本地 SQLite + 本地原文缓存                                                                                             |
| 第一版形态      | MCP tools + CLI 调试工具                                                                                           |
| 第一版不做      | 透明 HTTP proxy、WebSocket provider interception、多 provider auth、云同步、复杂 UI、ML 模型压缩、图像压缩、自动改 CLAUDE.md / AGENTS.md |

---

# 2. 产品背景

AI Coding Agent 在真实项目开发中会遇到两类核心上下文问题。

第一类是：

```text
上下文太长。
```

开发者让 Agent 跑测试、构建项目、读取大文件、分析日志、处理 RAG chunks 时，经常会产生大量上下文：

```text
测试日志
构建输出
命令行 stdout / stderr
长代码文件
长 JSON
Markdown 文档
RAG chunks
历史对话摘要
工具调用结果
```

这些内容并非无用，但其中很多信息对当前任务价值较低。真正重要的通常是：

```text
失败测试名
错误文件路径
错误行号
Assertion 信息
Expected / Received
stack trace 关键部分
exit code
public API
type/interface
关键配置
source ref
```

如果全部原样注入模型，会造成：

```text
token 浪费
上下文窗口被挤占
Agent 注意力分散
响应变慢
成本上升
关键信息被淹没
```

第二类是：

```text
项目上下文会被遗忘，也会被旧信息污染。
```

AI Coding Agent 跨会话工作时，经常忘记：

```text
项目使用 pnpm 还是 npm
项目架构约束
最近修到哪里
某个 bug 是否已经修复
上次测试失败原因
哪些文件不能随便改
某个 API contract 是否已变更
```

如果只用简单 `MEMORY.md`，又会遇到：

```text
信息无类型
信息难遗忘
旧事实污染
无法按项目隔离
无法审计
无法知道 Agent 到底有没有召回记忆
```

因此，本项目要解决的不是单一的“压缩问题”，也不是单一的“记忆问题”，而是构建一个面向 AI Coding Agent 的本地上下文服务层：

```text
压缩上下文，减少 token 浪费
保存原文，保证可恢复
记录 receipt，保证可审计
按 repo scope 隔离，避免项目污染
保存重要项目上下文，支持召回和遗忘
用 profile 区分长期稳定事实和近期动态任务
```

---

# 3. 产品定位

## 3.1 一句话定位

CodeContext MCP 是一个本地优先的 MCP 上下文服务层，为 AI Coding Agent 提供上下文压缩、原文取回、token 统计、项目级记忆、可控召回、可遗忘和可审计能力。

---

## 3.2 产品本质

本项目同时包含两个核心子系统：

```text
Context Compression Layer
Project Memory Layer
```

二者同等重要，但职责不同。

### Context Compression Layer

负责：

```text
识别上下文类型
压缩工具输出、日志、代码、RAG chunks
减少 token 消耗
保存原文
支持 retrieve_original
记录 tokens saved
保证压缩失败不影响 Agent
```

### Project Memory Layer

负责：

```text
保存项目长期规则
保存近期任务状态
保存历史 bug / decision / test_failure
支持 recall_context
支持 forget_context
支持 list_context
按 repo scope 隔离
维护 repo_profile.static / dynamic
记录 retrieval_receipt
```

---

## 3.3 产品不是

本项目不是：

```text
单纯 token 压缩器
单纯 MEMORY.md 生成器
通用笔记软件
云端知识库
企业级权限系统
OAuth 连接器平台
多模态文件处理平台
透明 HTTP proxy
WebSocket interception 层
自动接管所有模型请求的 Agent 框架
自动生成 CLAUDE.md / AGENTS.md 的工具
```

---

## 3.4 产品价值排序

产品最终价值不是二选一，而是组合价值：

```text
1. 压缩上下文，让 Agent 看到更少但更关键的内容
2. 保留原文，让压缩不会造成不可恢复的信息损失
3. 保存项目记忆，让 Agent 跨会话知道项目事实和近期任务
4. 支持遗忘和生命周期，避免旧记忆污染
5. 按 repo scope 隔离，避免多个项目上下文混淆
6. 通过 receipt 和统计，让 recall / compress 都可证明、可审计
```

---

# 4. 目标用户

## 4.1 核心用户

### 用户 1：高频 AI Coding Agent 用户

特征：

```text
每天使用 Claude Code / Cursor / OpenCode / Codex CLI
经常让 Agent 读文件、跑测试、看日志、改代码
经常遇到上下文过长
经常需要延续上一轮任务
```

核心需求：

```text
压缩长上下文
保留关键错误信息
让 Agent 记住项目规则和历史任务
避免每次重复解释
```

---

### 用户 2：多项目开发者

特征：

```text
同时维护多个 repo
不同 repo 技术栈不同
不同 repo 包管理器不同
不同 repo 的历史问题不同
```

核心需求：

```text
repo scope 隔离
当前项目记忆只在当前项目召回
当前项目压缩缓存只在当前项目可取回
```

---

### 用户 3：关注上下文成本和 Agent 可靠性的开发者

特征：

```text
关心 token 消耗
关心上下文窗口利用率
关心 Agent 是否被旧信息误导
关心压缩和召回是否可验证
```

核心需求：

```text
tokensBefore / tokensAfter / tokensSaved
compression receipt
retrieval receipt
list_context
forget_context
retrieve_original
```

---

### 用户 4：希望做 AI Agent / MCP 作品集项目的开发者

特征：

```text
希望项目能体现 MCP 能力
希望体现 context engineering 能力
希望体现可靠性和数据建模能力
希望项目边界清晰、能落地、能演示
```

核心需求：

```text
清晰产品定位
真实痛点
可执行 MVP
技术亮点明确
不做过度设计
```

---

## 4.2 非目标用户

第一版不服务：

```text
需要云同步的知识库用户
需要 Gmail / Notion / Drive 连接器的用户
需要多用户权限系统的团队
需要复杂可视化后台的用户
需要图像 / PDF / 多模态压缩的用户
需要工具自动代理所有模型请求的用户
只想要一个静态 MEMORY.md 的用户
```

---

# 5. 需求真实性与可行性判断

## 5.1 需求真实性：高

原因：

```text
AI Coding Agent 的上下文窗口有限
日志、测试输出、代码文件过长是高频问题
跨会话遗忘项目规则是高频问题
项目事实会变化，必须支持遗忘和替换
多项目开发确实需要 scope 隔离
压缩和召回都需要可审计，否则用户不信任
```

---

## 5.2 技术可实现性：中高

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

---

## 5.3 项目复杂度：中偏高

如果范围控制合理，项目可落地。

可控版本：

```text
MCP tools
本地 SQLite
规则压缩
原文缓存
FTS5 检索
receipt
CLI demo
```

失控版本：

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

所以第一版必须严格砍掉失控版本中的能力。

---

## 5.4 差异化潜力：高

普通压缩工具的问题：

```text
只压缩，不知道项目上下文
压缩后原文不可恢复
没有 scope 隔离
没有长期记忆
没有 recall / forget
```

普通记忆工具的问题：

```text
只记忆，不解决上下文过长
容易堆积旧信息
没有压缩统计
不能处理工具输出和日志
```

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

---

## 5.5 当前是否值得继续推进

结论：

```text
值得继续推进，但必须采用“双核心产品定位 + 分阶段开发顺序”。
```

正确理解：

```text
产品上：上下文压缩和项目记忆同等重要
开发上：先实现压缩上下文，再实现记忆服务
```

---

# 6. 产品目标

## 6.1 总体目标

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

---

## 6.2 MVP 目标

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

---

## 6.3 V1 目标

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

---

## 6.4 V2 目标

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

# 7. 核心设计原则

## 7.1 双核心原则

本项目有两个同等重要的核心：

```text
上下文压缩
项目记忆
```

不能把任意一方设计成无关紧要的附属功能。

正确关系是：

```text
压缩解决“上下文太长”
记忆解决“上下文会忘、会过期、会污染”
scope 解决“项目隔离”
receipt 解决“可证明、可审计”
originalRef 解决“可恢复”
profile 解决“长期事实 + 近期任务”
```

---

## 7.2 开发顺序原则

虽然产品是双核心，但开发顺序应为：

```text
先压缩上下文
再记忆服务
```

原因：

```text
压缩闭环更容易独立验证
测试日志和工具输出是高频刚需
压缩收益可用 token saved 直接证明
记忆服务依赖 scope、receipt、sourceRef 等基础设施
先做压缩可复用原文存储和 receipt 体系
```

---

## 7.3 ContentRouter 必须吸收

必须先识别内容类型，再选择压缩策略。

支持内容类型：

```text
test_output
log
command_output
code
json
markdown
plain_text
rag_chunk
file_summary
conversation_history
unknown
```

原因：

```text
测试日志、代码、JSON、RAG chunks 的关键信息完全不同
通用摘要会误删关键信息
分类是压缩质量的基础
```

---

## 7.4 CCR 必须吸收

CCR 在本项目中定义为：

```text
Compressed Context Record
```

每次压缩必须生成 CCR。

CCR 必须支持：

```text
compressedContent
originalRef
contentType
strategy
tokensBefore
tokensAfter
tokensSaved
compressionRatio
canRetrieveOriginal
sourceRef
scopeId
receiptId
```

---

## 7.5 压缩后必须能 retrieve 原文

压缩不能是不可逆黑箱。

必须支持：

```text
retrieve_original(originalRef)
```

原因：

```text
Agent 可能需要完整日志细节
用户可能需要检查压缩是否错误
压缩策略可能遗漏信息
原文可取回能显著降低压缩风险
```

---

## 7.6 安全兜底必须吸收

压缩失败时必须：

```text
返回原文
不阻断 Agent
不返回空内容
不返回损坏内容
记录 failed=true
记录 errorReason
生成 receipt
```

原则：

```text
宁可不压缩，也不能影响 Agent 正常工作。
```

---

## 7.7 统计能力必须吸收

必须统计：

```text
tokensBefore
tokensAfter
tokensSaved
compressionRatio
compressedCount
retrieveCount
recallCount
memoryCount
forgetCount
failureCount
```

作用：

```text
证明压缩是否有效
证明 recall 是否发生
调试策略质量
增强用户信任
便于作品集展示
```

---

## 7.8 代码压缩必须保守

代码压缩不能像普通文本摘要一样处理。

必须保留：

```text
file path
imports
exports
type/interface
function signature
class signature
public API
TODO/FIXME
错误相关代码块
query 相关代码块
行号
```

禁止：

```text
改写代码逻辑
删除 public API
删除类型定义
删除错误相关行
删除用户明确关注的范围
默认激进摘要
```

---

## 7.9 按需 MCP 工具优先

第一版采用 MCP tools，而不是透明代理。

原因：

```text
开发成本低
集成简单
调试容易
失败影响小
不需要处理 provider API key
不需要兼容 streaming
```

第一版不做：

```text
透明 HTTP proxy
WebSocket provider interception
多 provider auth
```

---

## 7.10 大输入保护必须吸收

必须支持：

```text
timeout
size limit
chunking
fail-open
```

因为核心输入就是长日志、大文件、长工具输出。

---

## 7.11 记忆必须可调用、可召回、可遗忘、可隔离、可审计

项目记忆层必须吸收以下思想：

```text
remember_context
recall_context
forget_context
list_context
current_scope
repo_profile.static
repo_profile.dynamic
retrieval_receipt
```

不能只是生成：

```text
MEMORY.md
```

原因：

```text
编码项目里的信息会过期
只能保存不能遗忘会污染 Agent
只靠搜索碎片不能提供完整项目上下文
没有 list 就无法审计
没有 scope 就会跨项目混淆
没有 receipt 就不知道是否真的召回
```

---

# 8. 功能优先级

## 8.1 P0：压缩基础设施，也是记忆服务基础设施

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

说明：

这些能力虽然以压缩为先，但也是后续记忆服务的基础：

```text
scopeId 可复用于 memory
receipt 可复用于 retrieval
sourceRef 可关联 originalRef
compressed records 可转为 memory
```

---

## 8.2 P1：项目记忆服务闭环

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

说明：

P1 不是可有可无的锦上添花，而是产品第二核心。

---

## 8.3 P2：压缩与记忆融合增强

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

---

## 8.4 P3：智能化与扩展

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

---

## 8.5 第一版不建议做

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

# 9. 必须吸收、后续吸收、不建议吸收

## 9.1 必须吸收

### 1. ContentRouter

要求：

```text
先识别内容类型，再选择压缩策略
```

适用：

```text
log
test_output
command_output
code
json
markdown
plain_text
rag_chunk
conversation_history
```

---

### 2. CCR：压缩后仍能 retrieve 原文

要求：

```text
每次压缩生成 CompressedContextRecord
原文保存到 OriginalContentStore
返回 originalRef
支持 retrieve_original
```

---

### 3. 安全兜底

要求：

```text
压缩失败返回原文
不影响 Agent
receipt 记录失败原因
```

---

### 4. 统计能力

要求展示：

```text
tokens saved
压缩次数
retrieve 次数
recall 次数
forget 次数
failure 次数
```

---

### 5. 保守代码压缩

要求：

```text
代码默认保守压缩
不激进摘要
不改写语义
不删除 public API / 类型定义 / 错误相关行
```

---

### 6. 按需 MCP 工具

要求：

```text
第一版通过 MCP tools 显式调用
不要一上来做透明代理
```

---

### 7. 大输入保护

要求：

```text
timeout
size limit
chunking
fail-open
```

---

## 9.2 可以后续吸收

### 1. CacheAligner

适合：

```text
proxy / SDK 层
重复输入缓存
相同日志复用压缩结果
```

不放第一版原因：

```text
需要处理 content hash、策略版本、scope、cache invalidation
会增加复杂度
```

---

### 2. IntelligentContext

适合：

```text
结合会话历史决定是否压缩
自动选择上下文
MVP 可不做
```

不放第一版原因：

```text
容易变成 Agent 框架
需要更多行为数据
```

---

### 3. TOIN 学习

适合：

```text
长期优化压缩和记忆策略
```

不放第一版原因：

```text
第一版数据不足
效果难验证
```

---

### 4. headroom_read

适合：

```text
可信上下文读取工具
```

第一版取舍：

```text
可以借鉴
但不要默认替代用户 Read 工具
```

---

### 5. Failure learning

适合：

```text
记录压缩失败
记录高 retrieveCount 的压缩结果
记录被用户 forget 的错误记忆
后续优化策略
```

第一版只记录，不学习。

---

## 9.3 不建议第一版吸收

```text
透明 HTTP proxy
WebSocket provider interception
多 provider auth 适配
ML 模型压缩文本
图像压缩
自动改 CLAUDE.md / AGENTS.md
```

原因：

```text
与 MVP 核心闭环关系弱
开发成本高
稳定性风险高
安全风险高
容易导致项目失控
```

---

# 10. 核心用户场景

## 10.1 场景一：压缩测试日志

用户让 Agent 跑测试：

```bash
pnpm test
```

输出 30000 tokens。

Agent 调用：

```text
compress_context(contentType="test_output", content="...")
```

系统返回：

```text
失败测试名
失败文件路径
Assertion 信息
Expected / Received
关键 stack trace
exit code
tokensBefore
tokensAfter
tokensSaved
originalRef
receiptId
```

Agent 如果需要完整日志：

```text
retrieve_original(originalRef)
```

---

## 10.2 场景二：压缩代码文件

Agent 读取一个 2000 行 TypeScript 文件。

系统压缩为：

```text
file path
imports
exports
type/interface
function signatures
class signatures
relevant blocks
folded sections
originalRef
```

要求：

```text
不改写代码
不删除 public API
不删除类型定义
不删除错误相关块
```

---

## 10.3 场景三：压缩 RAG chunks

一次检索返回多个 chunks。

系统压缩为：

```text
source
chunkId
score
key facts
short excerpt
canExpand
originalRef
```

Agent 需要细节时可取回原文。

---

## 10.4 场景四：保存项目规则

用户告诉 Agent：

```text
本项目使用 pnpm，不要使用 npm。
```

Agent 调用：

```text
remember_context(type="project_rule", content="本项目使用 pnpm，不要使用 npm。", profileTarget="static")
```

后续用户说：

```text
帮我安装 zod。
```

Agent 调用：

```text
recall_context(query="package manager install dependency")
```

系统返回：

```text
repo_profile.static: 本项目使用 pnpm，不要使用 npm。
```

Agent 应使用：

```bash
pnpm add zod
```

---

## 10.5 场景五：旧记忆替换

旧记忆：

```text
本项目使用 npm。
```

新记忆：

```text
本项目已迁移到 pnpm。
```

Agent 或用户调用：

```text
forget_context(id="mem_old", mode="supersede", supersededBy="mem_new")
```

后续 recall 默认不再返回旧 npm 记忆。

---

## 10.6 场景六：继续上次任务

记忆：

```text
current_task: 正在修 auth/session.ts 中 refresh token 过期后没有清理 cookie 的问题。
```

新会话中 Agent 调用：

```text
recall_context(query="continue previous auth task")
```

返回：

```text
repo_profile.dynamic
current_task
related test_failure
related compressed log
```

---

## 10.7 场景七：审计记忆和压缩记录

用户调用：

```text
list_context(types=["project_rule"], status=["active"])
list_compressions(contentType="test_output")
get_receipt(receiptId)
```

用于：

```text
检查错误记忆
清理过期记忆
查看压缩是否有效
确认 recall 是否发生
```

---

## 10.8 场景八：repo scope 隔离

repo A：

```text
使用 pnpm
```

repo B：

```text
使用 uv
```

在 repo A recall：

```text
package manager
```

只能返回 repo A 的 pnpm，不得返回 repo B 的 uv。

---

# 11. MCP Tool 设计

## 11.1 current_scope

### 目的

识别当前项目 scope，用于隔离压缩缓存、原文、receipt、memory、profile。

### 优先级

P0

### 输入

```json
{
  "cwd": "/path/to/repo"
}
```

### 输出

```json
{
  "scopeId": "repo_8f3a91c2",
  "gitRoot": "/path/to/repo",
  "remote": "git@github.com:user/repo.git",
  "branch": "main",
  "scopeStrategy": "hash(gitRemote + gitRoot)"
}
```

### 规则

```text
优先 hash(git remote + git root path)
无 remote 时 hash(git root path)
非 git repo 时 hash(cwd)
```

### 验收标准

```text
同一 repo scopeId 稳定
不同 repo scopeId 不同
scopeId 写入 compression receipt 和 retrieval receipt
```

---

## 11.2 compress_context

### 目的

压缩长上下文，减少 token 消耗，同时保存原文并生成审计记录。

### 优先级

P0

### 输入

```json
{
  "scopeId": "repo_8f3a91c2",
  "content": "long content here",
  "contentType": "test_output",
  "metadata": {
    "source": "pnpm test",
    "command": "pnpm test",
    "filePath": null
  },
  "strategy": "auto",
  "keepOriginal": true,
  "maxTokens": 2000,
  "timeoutMs": 5000
}
```

### 输出

```json
{
  "ccrId": "ccr_01HXYZ",
  "compressed": true,
  "scopeId": "repo_8f3a91c2",
  "contentType": "test_output",
  "strategy": "test_output_conservative_v1",
  "compressedContent": "压缩后的内容",
  "summary": "auth/session.test.ts failed because cookie was not cleared.",
  "originalRef": "orig_01HXYZ",
  "tokensBefore": 30000,
  "tokensAfter": 1800,
  "tokensSaved": 28200,
  "compressionRatio": 0.94,
  "canRetrieveOriginal": true,
  "receiptId": "rcp_01HXYZ",
  "warnings": []
}
```

### 失败输出

```json
{
  "ccrId": "ccr_01HXYZ",
  "compressed": false,
  "scopeId": "repo_8f3a91c2",
  "contentType": "test_output",
  "compressedContent": "原文内容",
  "originalRef": "orig_01HXYZ",
  "tokensBefore": 30000,
  "tokensAfter": 30000,
  "tokensSaved": 0,
  "compressionRatio": 0,
  "canRetrieveOriginal": true,
  "receiptId": "rcp_01HXYZ",
  "failed": true,
  "errorReason": "compression_timeout",
  "warnings": ["Compression failed open and returned original content."]
}
```

---

## 11.3 retrieve_original

### 目的

根据 originalRef 取回压缩前原文。

### 优先级

P0

### 输入

```json
{
  "scopeId": "repo_8f3a91c2",
  "originalRef": "orig_01HXYZ",
  "offset": 0,
  "limit": 10000
}
```

### 输出

```json
{
  "scopeId": "repo_8f3a91c2",
  "originalRef": "orig_01HXYZ",
  "contentType": "test_output",
  "content": "原始内容",
  "tokens": 30000,
  "metadata": {
    "source": "pnpm test",
    "command": "pnpm test"
  },
  "createdAt": "2026-06-09T10:00:00Z",
  "receiptId": "rcp_retrieve_01"
}
```

### 规则

```text
只能在同 scope 下取回
大原文支持 offset / limit
retrieve 操作增加 retrieveCount
retrieve 操作生成 receipt
```

---

## 11.4 get_receipt

### 目的

查看 compress / recall / remember / forget / retrieve 的审计记录。

### 优先级

P1

### 输入

```json
{
  "receiptId": "rcp_01HXYZ"
}
```

### 输出

```json
{
  "id": "rcp_01HXYZ",
  "operation": "compress",
  "scopeId": "repo_8f3a91c2",
  "inputHash": "sha256_xxx",
  "resultIds": ["ccr_01HXYZ"],
  "originalRefs": ["orig_01HXYZ"],
  "tokensBefore": 30000,
  "tokensAfter": 1800,
  "tokensSaved": 28200,
  "compressionRatio": 0.94,
  "failed": false,
  "timestamp": "2026-06-09T10:00:00Z"
}
```

---

## 11.5 list_compressions

### 目的

列出当前项目的压缩记录。

### 优先级

P1

### 输入

```json
{
  "scopeId": "repo_8f3a91c2",
  "contentType": "test_output",
  "limit": 20,
  "offset": 0
}
```

### 输出

```json
{
  "scopeId": "repo_8f3a91c2",
  "items": [
    {
      "ccrId": "ccr_01HXYZ",
      "contentType": "test_output",
      "summary": "auth/session.test.ts failed because cookie was not cleared.",
      "originalRef": "orig_01HXYZ",
      "tokensBefore": 30000,
      "tokensAfter": 1800,
      "tokensSaved": 28200,
      "retrieveCount": 1,
      "createdAt": "2026-06-09T10:00:00Z"
    }
  ]
}
```

---

## 11.6 remember_context

### 目的

保存结构化项目记忆。

### 优先级

P1

### 输入

```json
{
  "scopeId": "repo_8f3a91c2",
  "type": "project_rule",
  "content": "本项目使用 pnpm，不要使用 npm。",
  "summary": "Package manager is pnpm.",
  "sourceRef": "user:manual",
  "confidence": 0.95,
  "profileTarget": "static",
  "expiresAt": null
}
```

### 输出

```json
{
  "memoryId": "mem_01HXYZ",
  "scopeId": "repo_8f3a91c2",
  "type": "project_rule",
  "status": "active",
  "receiptId": "rcp_mem_01"
}
```

### 规则

```text
不传 scopeId 时使用 current_scope
默认 status=active
sourceRef 可指向 originalRef、ccrId、文件路径或 user:manual
profileTarget=static 时写入 repo_profile.static
profileTarget=dynamic 时写入 repo_profile.dynamic
```

---

## 11.7 recall_context

### 目的

召回当前项目的 profile、相关记忆和必要的压缩上下文引用。

### 优先级

P1

### 输入

```json
{
  "scopeId": "repo_8f3a91c2",
  "query": "install dependency package manager",
  "types": ["project_rule", "dependency", "decision"],
  "limit": 5,
  "includeProfile": true,
  "includeCompressedRefs": true,
  "retrieveOriginal": false
}
```

### 输出

```json
{
  "scopeId": "repo_8f3a91c2",
  "profile": {
    "static": [
      {
        "id": "pf_static_1",
        "content": "本项目使用 pnpm，不要使用 npm。",
        "sourceMemoryId": "mem_01HXYZ"
      }
    ],
    "dynamic": [
      {
        "id": "pf_dynamic_1",
        "content": "当前正在修复 auth/session.ts 的 refresh token 问题。",
        "sourceMemoryId": "mem_02HXYZ"
      }
    ]
  },
  "memories": [
    {
      "id": "mem_01HXYZ",
      "type": "project_rule",
      "summary": "Package manager is pnpm.",
      "content": "本项目使用 pnpm，不要使用 npm。",
      "sourceRef": "user:manual",
      "confidence": 0.95,
      "status": "active",
      "score": 0.82,
      "canExpand": false
    }
  ],
  "relatedCompressedContexts": [
    {
      "ccrId": "ccr_01HXYZ",
      "summary": "auth/session.test.ts failed because cookie was not cleared.",
      "originalRef": "orig_01HXYZ",
      "canRetrieveOriginal": true
    }
  ],
  "receiptId": "rcp_recall_01"
}
```

### 规则

```text
默认只返回 active 记忆
默认返回 repo_profile.static / dynamic
superseded / forgotten / expired 默认不返回
每次 recall 必须生成 retrieval_receipt
没有结果也要生成 receipt
```

---

## 11.8 forget_context

### 目的

遗忘、过期或替换项目记忆，防止旧信息污染 Agent。

### 优先级

P1

### 输入

```json
{
  "id": "mem_01HXYZ",
  "mode": "supersede",
  "reason": "项目已从 npm 迁移到 pnpm。",
  "supersededBy": "mem_02HXYZ"
}
```

### mode

```text
soft_forget
supersede
expire
hard_delete
```

MVP 建议支持：

```text
soft_forget
supersede
expire
```

hard_delete 可保留接口，但默认不开放或需要 confirm。

### 输出

```json
{
  "memoryId": "mem_01HXYZ",
  "previousStatus": "active",
  "newStatus": "superseded",
  "supersededBy": "mem_02HXYZ",
  "receiptId": "rcp_forget_01"
}
```

---

## 11.9 list_context

### 目的

列出当前项目记忆，用于审计、清理和调试 recall。

### 优先级

P1

### 输入

```json
{
  "scopeId": "repo_8f3a91c2",
  "types": ["project_rule"],
  "status": ["active"],
  "limit": 50,
  "offset": 0
}
```

### 输出

```json
{
  "scopeId": "repo_8f3a91c2",
  "items": [
    {
      "id": "mem_01HXYZ",
      "type": "project_rule",
      "summary": "Package manager is pnpm.",
      "status": "active",
      "sourceRef": "user:manual",
      "confidence": 0.95,
      "createdAt": "2026-06-09T10:00:00Z",
      "updatedAt": "2026-06-09T10:00:00Z"
    }
  ],
  "total": 1
}
```

---

# 12. ContentRouter 设计

## 12.1 支持内容类型

```text
test_output
log
command_output
code
json
markdown
plain_text
rag_chunk
file_summary
conversation_history
unknown
```

---

## 12.2 类型识别规则

### test_output

识别信号：

```text
FAIL
failed
AssertionError
Expected
Received
jest
vitest
pytest
mocha
unittest
test failed
```

---

### log

识别信号：

```text
ERROR
WARN
INFO
Exception
Traceback
stack trace
timestamp
request id
```

---

### command_output

识别信号：

```text
stdout
stderr
exit code
command
build failed
shell output
```

---

### code

识别信号：

```text
import
export
function
class
interface
type
const
def
public
private
return
```

---

### json

识别信号：

```text
以 { 或 [ 开头
可被 JSON.parse
```

---

### markdown

识别信号：

```text
# heading
- list
fenced code block
```

---

### rag_chunk

识别信号：

```text
source
chunk
document
metadata
score
```

---

## 12.3 输出

```json
{
  "contentType": "test_output",
  "confidence": 0.92,
  "signals": ["FAIL", "AssertionError", "Expected", "Received"]
}
```

---

# 13. 压缩策略设计

## 13.1 总体原则

压缩必须保留：

```text
错误信息
路径
行号
命令
exit code
stack trace 关键部分
source ref
metadata
可取回原文的 originalRef
```

压缩不得默认删除：

```text
错误栈
失败测试名称
文件路径
public API
类型定义
用户明确关注内容
```

---

## 13.2 test_output 压缩

保留：

```text
测试命令
测试框架
失败测试文件
失败测试名称
Assertion 信息
Expected / Received
stack trace 关键部分
exit code
最后 N 行
```

折叠：

```text
通过测试列表
重复日志
大段 snapshot
无关 debug 输出
```

输出格式：

```markdown
## Test Output Summary

- Command:
- Framework:
- Status:
- Failed Tests:
- Key Error:
- Expected:
- Received:
- Stack Trace:
- Exit Code:
- Original Ref:
```

---

## 13.3 log 压缩

保留：

```text
ERROR / WARN
异常类型
错误 message
timestamp
trace id / request id
相关文件路径
stack trace 顶部和底部
```

折叠：

```text
重复 INFO
重复 heartbeat
重复 debug
```

---

## 13.4 command_output 压缩

保留：

```text
命令
退出码
stderr
失败原因
错误文件
错误行号
最后 N 行
```

折叠：

```text
重复进度条
安装日志
无关 warning
成功输出
```

---

## 13.5 code 压缩

保留：

```text
file path
imports
exports
type/interface
function signature
class signature
public methods
TODO/FIXME
error-related block
query-related block
line numbers
```

折叠：

```text
无关私有实现
长函数体
重复 boilerplate
生成代码
```

禁止：

```text
改写代码语义
删除 public API
删除类型定义
删除错误相关行
```

输出格式：

```markdown
## Code Context Summary

- File:
- Imports:
- Exports:
- Types / Interfaces:
- Public APIs:
- Relevant Blocks:
- Folded Sections:
- Original Ref:
```

---

## 13.6 json 压缩

保留：

```text
top-level keys
schema shape
error fields
status fields
id fields
重要 nested path
数组样本
```

折叠：

```text
长数组
重复对象
超长文本字段
```

---

## 13.7 markdown / plain_text 压缩

保留：

```text
标题
关键段落
列表结构
代码块摘要
source ref
```

折叠：

```text
重复说明
低相关段落
长示例
```

---

## 13.8 rag_chunk 压缩

保留：

```text
source
document title
chunk id
score
key facts
short excerpt
canExpand
```

折叠：

```text
重复 chunks
低相关段落
长引用
```

---

## 13.9 conversation_history 压缩

保留：

```text
用户当前目标
已完成步骤
未完成步骤
关键决策
最近错误
需要保留的文件路径
```

折叠：

```text
寒暄
重复解释
低价值中间过程
已被 supersede 的上下文
```

---

# 14. 项目记忆服务设计

## 14.1 记忆服务目标

记忆服务要解决：

```text
项目事实跨会话遗忘
旧记忆污染
记忆不可审计
记忆无法按项目隔离
召回只返回碎片，不返回项目画像
```

---

## 14.2 Memory API 思路

必须同时支持：

```text
remember
recall
forget
list
```

不能只做：

```text
save memory
```

原因：

```text
项目里的事实会变化
只能写入不能遗忘会污染 Agent
```

---

## 14.3 MemoryRecord 类型

支持类型：

```text
decision
bug
command
file_summary
project_rule
user_preference
current_task
test_failure
api_contract
dependency
```

说明：

```text
decision：长期设计决策
bug：历史 bug 或当前 bug
command：有意义的命令结果
file_summary：文件摘要
project_rule：项目规则
user_preference：用户偏好
current_task：当前任务状态
test_failure：测试失败信息
api_contract：接口契约
dependency：依赖、包管理器、版本相关信息
```

---

## 14.4 Memory lifecycle

状态：

```text
active
superseded
forgotten
expired
```

规则：

```text
active 默认参与 recall
superseded 默认不参与 recall
forgotten 默认不参与 recall
expired 默认不参与 recall
list_context 可查看非 active 记忆
```

---

## 14.5 repo_profile.static

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

---

## 14.6 repo_profile.dynamic

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

---

## 14.7 recall_context 返回结构

recall 不应只是简单搜索几条 memory。

应返回：

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

---

# 15. 数据模型

## 15.1 ScopeRecord

```ts
type ScopeRecord = {
  scopeId: string
  gitRoot?: string
  remote?: string
  branch?: string
  cwd: string
  scopeStrategy:
    | "gitRemote+gitRoot"
    | "gitRootOnly"
    | "cwdFallback"
  createdAt: string
  updatedAt: string
}
```

---

## 15.2 CompressedContextRecord

```ts
type CompressedContextRecord = {
  id: string
  scopeId: string
  contentType:
    | "test_output"
    | "log"
    | "command_output"
    | "code"
    | "json"
    | "markdown"
    | "plain_text"
    | "rag_chunk"
    | "file_summary"
    | "conversation_history"
    | "unknown"
  strategy: string
  compressedContent: string
  summary?: string
  originalRef?: string
  sourceRef?: string
  metadata?: Record<string, unknown>
  tokensBefore: number
  tokensAfter: number
  tokensSaved: number
  compressionRatio: number
  canRetrieveOriginal: boolean
  retrieveCount: number
  failed: boolean
  errorReason?: string
  createdAt: string
  updatedAt: string
  expiresAt?: string
}
```

---

## 15.3 OriginalContentRecord

```ts
type OriginalContentRecord = {
  id: string
  scopeId: string
  ccrId: string
  contentType: string
  content: string
  contentHash: string
  tokens: number
  metadata?: Record<string, unknown>
  createdAt: string
  expiresAt?: string
}
```

---

## 15.4 MemoryRecord

```ts
type MemoryRecord = {
  id: string
  scopeId: string
  type:
    | "decision"
    | "bug"
    | "command"
    | "file_summary"
    | "project_rule"
    | "user_preference"
    | "current_task"
    | "test_failure"
    | "api_contract"
    | "dependency"
  content: string
  summary?: string
  sourceRef?: string
  confidence: number
  status:
    | "active"
    | "superseded"
    | "forgotten"
    | "expired"
  createdAt: string
  updatedAt: string
  expiresAt?: string
  supersedes?: string[]
  supersededBy?: string
  tags?: string[]
}
```

---

## 15.5 RepoProfile

```ts
type RepoProfile = {
  scopeId: string
  staticFacts: ProfileFact[]
  dynamicContext: ProfileFact[]
  updatedAt: string
}

type ProfileFact = {
  id: string
  scopeId: string
  layer: "static" | "dynamic"
  content: string
  sourceMemoryId?: string
  sourceRef?: string
  confidence: number
  createdAt: string
  updatedAt: string
  expiresAt?: string
}
```

---

## 15.6 Receipt

统一 receipt，覆盖压缩和记忆。

```ts
type Receipt = {
  id: string
  operation:
    | "compress"
    | "retrieve_original"
    | "remember"
    | "recall"
    | "forget"
    | "list"
  scopeId: string
  inputHash?: string
  query?: string
  resultIds?: string[]
  memoryIds?: string[]
  ccrIds?: string[]
  originalRefs?: string[]
  tokensBefore?: number
  tokensAfter?: number
  tokensSaved?: number
  compressionRatio?: number
  compressed?: boolean
  retrievedOriginal?: boolean
  failed?: boolean
  errorReason?: string
  timestamp: string
}
```

---

# 16. SQLite 表设计

## 16.1 scopes

```sql
CREATE TABLE scopes (
  scope_id TEXT PRIMARY KEY,
  git_root TEXT,
  remote TEXT,
  branch TEXT,
  cwd TEXT NOT NULL,
  scope_strategy TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

---

## 16.2 compressed_contexts

```sql
CREATE TABLE compressed_contexts (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  strategy TEXT NOT NULL,
  compressed_content TEXT NOT NULL,
  summary TEXT,
  original_ref TEXT,
  source_ref TEXT,
  metadata TEXT,
  tokens_before INTEGER NOT NULL,
  tokens_after INTEGER NOT NULL,
  tokens_saved INTEGER NOT NULL,
  compression_ratio REAL NOT NULL,
  can_retrieve_original INTEGER NOT NULL DEFAULT 1,
  retrieve_count INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  error_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (scope_id) REFERENCES scopes(scope_id)
);
```

---

## 16.3 original_contents

```sql
CREATE TABLE original_contents (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  ccr_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (scope_id) REFERENCES scopes(scope_id),
  FOREIGN KEY (ccr_id) REFERENCES compressed_contexts(id)
);
```

---

## 16.4 memories

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  source_ref TEXT,
  confidence REAL NOT NULL DEFAULT 0.8,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  superseded_by TEXT,
  tags TEXT,
  FOREIGN KEY (scope_id) REFERENCES scopes(scope_id)
);
```

---

## 16.5 memories_fts

```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
  id UNINDEXED,
  scope_id UNINDEXED,
  type UNINDEXED,
  summary,
  content,
  source_ref
);
```

---

## 16.6 profile_facts

```sql
CREATE TABLE profile_facts (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL,
  layer TEXT NOT NULL,
  content TEXT NOT NULL,
  source_memory_id TEXT,
  source_ref TEXT,
  confidence REAL NOT NULL DEFAULT 0.8,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (scope_id) REFERENCES scopes(scope_id),
  FOREIGN KEY (source_memory_id) REFERENCES memories(id)
);
```

---

## 16.7 receipts

```sql
CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  input_hash TEXT,
  query TEXT,
  result_ids TEXT,
  memory_ids TEXT,
  ccr_ids TEXT,
  original_refs TEXT,
  tokens_before INTEGER,
  tokens_after INTEGER,
  tokens_saved INTEGER,
  compression_ratio REAL,
  compressed INTEGER,
  retrieved_original INTEGER,
  failed INTEGER DEFAULT 0,
  error_reason TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (scope_id) REFERENCES scopes(scope_id)
);
```

---

# 17. 本地存储结构

默认目录：

```text
~/.code-context-mcp/
```

建议结构：

```text
~/.code-context-mcp/
  code-context.sqlite
  originals/
  logs/
  config.json
```

说明：

```text
code-context.sqlite：结构化数据
originals/：大原文缓存
logs/：工具自身运行日志
config.json：本地配置
```

---

# 18. 配置项

```json
{
  "storagePath": "~/.code-context-mcp/code-context.sqlite",
  "originalsRetentionDays": 30,
  "defaultKeepOriginal": true,
  "maxInputBytes": 1048576,
  "maxOutputTokens": 2000,
  "compressionTimeoutMs": 5000,
  "recallTimeoutMs": 3000,
  "retrieveChunkSize": 10000,
  "failOpen": true,
  "defaultRecallLimit": 5,
  "maxRecallLimit": 20,
  "enableEmbeddings": false,
  "enableProxy": false,
  "defaultCompressionStrategy": "conservative"
}
```

---

# 19. 安全与隐私

## 19.1 本地优先

默认不上传：

```text
项目代码
测试日志
构建输出
命令输出
原文缓存
压缩结果
记忆内容
receipt
```

---

## 19.2 不处理模型 API key

第一版不做透明代理，所以不处理：

```text
OpenAI API key
Anthropic API key
Google API key
其他 provider key
```

---

## 19.3 原文缓存风险

原文可能包含：

```text
API key
环境变量
用户数据
内部接口
私有代码
错误堆栈
```

必须支持：

```text
配置原文保留时间
delete_original
cleanup_originals
关闭 keepOriginal
查看原文保存位置
```

---

## 19.4 scope 访问限制

必须保证：

```text
repo A 的 originalRef 不能在 repo B retrieve
repo A 的 memory 不能在 repo B recall
repo A 的 profile 不能污染 repo B
```

---

# 20. 错误处理

## 20.1 压缩失败

返回：

```text
原文
compressed=false
failed=true
errorReason
receiptId
```

---

## 20.2 recall 失败

返回：

```text
空 memories
空 related contexts
profile 可为空
failed=true
errorReason
receiptId
```

---

## 20.3 scope 解析失败

fallback：

```text
scopeId = hash(cwd)
scopeStrategy = cwdFallback
```

---

## 20.4 原文不存在

返回：

```text
failed=true
errorReason=original_not_found
```

---

## 20.5 SQLite 写入失败

要求：

```text
不影响 Agent 主流程
返回 warning
尽可能返回压缩或 recall 结果
```

---

# 21. 性能目标

| 操作                   |   MVP 目标 |
| -------------------- | -------: |
| current_scope        |  < 300ms |
| compress_context 小文本 | < 1000ms |
| compress_context 长日志 | < 5000ms |
| retrieve_original    | < 1000ms |
| remember_context     |  < 500ms |
| recall_context       | < 1000ms |
| forget_context       |  < 500ms |
| list_context         |  < 500ms |

MVP 数据规模：

```text
单 repo 1000 条 compressed contexts
单 repo 1000 条 memories
本地总计 10000 条 records
单次输入默认最大 1MB
单条 memory content 默认最大 32KB
原文默认保留 30 天
```

---

# 22. CLI 设计

## 22.1 命令

```bash
code-context scope

code-context compress ./test-output.log --type test_output

code-context retrieve orig_01HXYZ

code-context list-compressions --type test_output

code-context remember --type project_rule --content "本项目使用 pnpm"

code-context recall "package manager"

code-context forget mem_01HXYZ --mode supersede --by mem_02HXYZ

code-context list-context --type project_rule --status active

code-context receipt rcp_01HXYZ

code-context stats

code-context cleanup --originals
```

---

## 22.2 CLI 价值

```text
不依赖 Agent 也能调试
方便写自动化测试
方便作品集演示
方便用户审计本地状态
```

---

# 23. 开发阶段规划

## Phase 0：产品边界与基础文档

产出：

```text
README.md
MVP_SPEC.md
MCP_TOOLS.md
DATA_MODEL.md
ARCHITECTURE.md
SECURITY.md
```

目标：

```text
明确双核心定位
明确先压缩后记忆的开发顺序
明确第一版不做 proxy / auth / UI / 云同步
```

---

## Phase 1：基础设施

实现：

```text
MCP Server
SQLite 初始化
current_scope
Receipt Service 基础
Token Counter
CLI skeleton
```

验收：

```text
MCP Server 可启动
current_scope 可返回稳定 scopeId
receipt 表可写入
```

---

## Phase 2：上下文压缩核心

实现：

```text
ContentRouter
compress_context
test_output compressor
command_output compressor
log compressor
plain_text compressor
CompressedContextRecord
OriginalContentStore
compression_receipt
```

验收：

```text
长测试日志可压缩
返回 originalRef
返回 tokensBefore / tokensAfter / tokensSaved
生成 receipt
```

---

## Phase 3：安全兜底和大输入保护

实现：

```text
timeout
size limit
chunking
fail-open
retrieve_original
delete_original
cleanup_originals
```

验收：

```text
超时返回原文
大输入不会卡死
原文可取回
原文可删除
```

---

## Phase 4：代码、JSON、Markdown、RAG 压缩

实现：

```text
code compressor
json compressor
markdown compressor
rag_chunk compressor
conversation_history compressor
```

验收：

```text
代码压缩保留 imports / exports / signatures
RAG chunks 保留 source / key facts / canExpand
```

---

## Phase 5：项目记忆服务闭环

实现：

```text
remember_context
recall_context
forget_context
list_context
MemoryRecord
Memory lifecycle
SQLite FTS5
retrieval_receipt
```

验收：

```text
保存项目规则
后续可 recall
旧记忆可 supersede
list_context 可审计
```

---

## Phase 6：Profile 分层与压缩记忆融合

实现：

```text
repo_profile.static
repo_profile.dynamic
save_compression_as_memory
recall_context 返回 relatedCompressedContexts
sourceRef 关联 originalRef / ccrId
```

验收：

```text
recall_context 返回 static + dynamic + top-k memories + related compressed contexts
```

---

## Phase 7：演示与作品集包装

产出：

```text
demo repo
fixtures
README screenshots
DEMO.md
演示脚本
```

演示：

```text
压缩长测试日志
retrieve 原文
保存项目规则
recall 项目规则
supersede 旧记忆
repo scope 隔离
receipt 审计
```

---

# 24. MVP 验收用例

## 24.1 压缩测试日志

输入：

```text
长 pnpm test 输出
```

预期：

```text
识别为 test_output
压缩失败测试
保留 stack trace
返回 originalRef
tokensAfter < tokensBefore
生成 receipt
```

---

## 24.2 原文取回

输入：

```text
retrieve_original(originalRef)
```

预期：

```text
返回完整原文
retrieveCount + 1
生成 receipt
```

---

## 24.3 压缩失败兜底

模拟：

```text
压缩超时
```

预期：

```text
返回原文
compressed=false
failed=true
Agent 不受影响
```

---

## 24.4 保存和召回项目规则

流程：

```text
remember_context 保存：本项目使用 pnpm
recall_context query=package manager
```

预期：

```text
返回 pnpm 规则
receipt 生成
```

---

## 24.5 旧记忆 supersede

流程：

```text
保存 npm
保存 pnpm
forget npm mode=supersede
recall package manager
```

预期：

```text
默认只返回 pnpm
list_context 可看到 npm 为 superseded
```

---

## 24.6 repo scope 隔离

流程：

```text
repo A 保存 pnpm
repo B 保存 uv
repo A recall package manager
```

预期：

```text
只返回 repo A 的 pnpm
不返回 repo B 的 uv
```

---

## 24.7 压缩结果转记忆

流程：

```text
compress_context 压缩测试失败日志
remember_context 保存其中关键 test_failure，sourceRef=ccrId/originalRef
recall_context query=auth test failure
```

预期：

```text
返回 test_failure memory
返回 related compressed context
可 retrieve 原文
```

---

# 25. README 演示场景

## Demo 1：压缩长测试日志

```bash
code-context compress ./fixtures/vitest-long-output.log --type test_output
```

展示：

```text
tokensBefore
tokensAfter
tokensSaved
compressionRatio
originalRef
receiptId
```

---

## Demo 2：取回原文

```bash
code-context retrieve orig_01HXYZ
```

展示：

```text
完整日志可恢复
```

---

## Demo 3：保存项目规则并召回

```bash
code-context remember --type project_rule --content "本项目使用 pnpm，不要使用 npm。"
code-context recall "install dependency package manager"
```

展示：

```text
返回 pnpm 规则
```

---

## Demo 4：旧记忆替换

```bash
code-context forget mem_old --mode supersede --by mem_new
```

展示：

```text
旧记忆不再默认 recall
list_context 可审计
```

---

## Demo 5：scope 隔离

```bash
cd repo-a
code-context remember --type project_rule --content "本项目使用 pnpm"

cd ../repo-b
code-context recall "package manager"
```

展示：

```text
repo-b 不返回 repo-a 的记忆
```

---

# 26. 技术架构

## 26.1 架构图

```text
AI Coding Agent
    ↓ MCP
CodeContext MCP Server
    ├── Scope Resolver
    ├── ContentRouter
    ├── Compression Engine
    │   ├── Test Output Compressor
    │   ├── Log Compressor
    │   ├── Command Output Compressor
    │   ├── Code Compressor
    │   ├── JSON Compressor
    │   ├── Markdown Compressor
    │   └── RAG Chunk Compressor
    ├── Original Content Store
    ├── Compressed Context Store
    ├── Memory Service
    │   ├── remember_context
    │   ├── recall_context
    │   ├── forget_context
    │   ├── list_context
    │   └── lifecycle
    ├── Profile Service
    │   ├── repo_profile.static
    │   └── repo_profile.dynamic
    ├── Receipt Service
    ├── Token Stats Service
    ├── Safety Layer
    │   ├── Timeout
    │   ├── Size Limit
    │   ├── Chunking
    │   └── Fail-open
    └── SQLite Storage
```

---

## 26.2 模块职责

### Scope Resolver

```text
识别 git root
读取 git remote
读取 branch
生成 scopeId
fallback 到 cwd
```

---

### ContentRouter

```text
识别内容类型
给出分类置信度
选择压缩策略
```

---

### Compression Engine

```text
执行类型化压缩
生成 compressedContent
记录 token 变化
```

---

### Original Content Store

```text
保存原文
生成 originalRef
支持 retrieve_original
支持 delete_original
支持过期清理
```

---

### Memory Service

```text
保存记忆
召回记忆
遗忘记忆
列出记忆
维护生命周期
```

---

### Profile Service

```text
维护 static facts
维护 dynamic context
在 recall 时合并返回
```

---

### Receipt Service

```text
记录 compress
记录 retrieve_original
记录 remember
记录 recall
记录 forget
记录失败原因
```

---

### Safety Layer

```text
timeout
size limit
chunking
fail-open
```

---

# 27. 推荐目录结构

```text
code-context-mcp/
  src/
    index.ts
    mcp/
      server.ts
      tools/
        currentScope.ts
        compressContext.ts
        retrieveOriginal.ts
        getReceipt.ts
        listCompressions.ts
        rememberContext.ts
        recallContext.ts
        forgetContext.ts
        listContext.ts
    scope/
      resolveScope.ts
      git.ts
    router/
      contentRouter.ts
      detectors/
        testOutputDetector.ts
        logDetector.ts
        codeDetector.ts
        jsonDetector.ts
        markdownDetector.ts
        ragChunkDetector.ts
    compression/
      compressionEngine.ts
      strategies/
        testOutput.ts
        log.ts
        commandOutput.ts
        code.ts
        json.ts
        markdown.ts
        plainText.ts
        ragChunk.ts
        conversationHistory.ts
    originals/
      originalStore.ts
    compressed/
      compressedStore.ts
    memory/
      memoryService.ts
      recallEngine.ts
      lifecycle.ts
      types.ts
    profile/
      profileService.ts
    receipts/
      receiptService.ts
    stats/
      tokenStats.ts
    safety/
      timeout.ts
      sizeLimit.ts
      chunking.ts
      failOpen.ts
    storage/
      db.ts
      migrations.ts
      schema.sql
    cli/
      index.ts
    utils/
      hash.ts
      tokenCount.ts
      time.ts
  tests/
    scope.test.ts
    contentRouter.test.ts
    compression.test.ts
    originalStore.test.ts
    memory.test.ts
    recall.test.ts
    lifecycle.test.ts
    profile.test.ts
    receipt.test.ts
    safety.test.ts
  fixtures/
    vitest-long-output.log
    build-output.log
    session.ts
    rag-chunks.json
  docs/
    MVP_SPEC.md
    MCP_TOOLS.md
    DATA_MODEL.md
    ARCHITECTURE.md
    SECURITY.md
    DEMO.md
  README.md
  package.json
  tsconfig.json
```

---

# 28. 文档要求

必须提供：

```text
README.md
MVP_SPEC.md
MCP_TOOLS.md
DATA_MODEL.md
ARCHITECTURE.md
SECURITY.md
DEMO.md
```

## README.md 必须说明

```text
这个项目解决什么问题
为什么是压缩 + 记忆双核心
为什么开发顺序先压缩再记忆
如何安装
如何配置 MCP
如何 compress_context
如何 retrieve_original
如何 remember_context
如何 recall_context
如何 forget_context
如何查看 receipt 和 stats
第一版不做什么
```

---

## SECURITY.md 必须说明

```text
所有数据默认本地保存
原文缓存可能包含敏感信息
如何清理 original contents
如何关闭 keepOriginal
不会上传用户数据
不会处理 provider API key
scope 隔离规则
```

---

# 29. 成功标准

## 29.1 MVP 成功标准

```text
MCP Server 可运行
current_scope 可识别 repo
compress_context 可压缩测试日志
compress_context 可压缩命令输出
compress_context 可压缩代码
retrieve_original 可取回原文
压缩失败 fail-open
receipt 可查看
tokens saved 可统计
SQLite 可持久化
```

---

## 29.2 V1 成功标准

```text
remember_context 可保存项目记忆
recall_context 可召回相关记忆
forget_context 可 supersede / expire / forget
list_context 可审计
repo_profile.static / dynamic 可返回
retrieval_receipt 可证明 recall 行为
memory 与 compressed context 可通过 sourceRef 关联
```

---

## 29.3 用户价值成功标准

用户使用后减少：

```text
长日志占用上下文
重复读取大文件的 token
重复告诉 Agent 项目规则的次数
Agent 用错包管理器的次数
Agent 重复排查旧 bug 的次数
旧记忆误导 Agent 的概率
不知道压缩和召回是否发生的不确定感
```

---

## 29.4 作品集成功标准

项目能展示：

```text
MCP 工具设计
上下文压缩策略
项目记忆服务设计
本地数据建模
生命周期管理
可观测性
安全兜底
scope 隔离
产品取舍能力
```

---

# 30. 风险分析

## 30.1 最大产品风险

风险：

```text
压缩和记忆两个方向都重要，容易做成大而全。
```

应对：

```text
产品定位双核心
开发顺序分阶段
MVP 先压缩，V1 补记忆
数据模型提前兼容两者
```

---

## 30.2 最大技术风险

风险：

```text
压缩质量不稳定，召回质量不稳定。
```

应对：

```text
压缩采用保守策略
代码压缩不改写语义
原文可 retrieve
recall 使用 type / status / confidence / scope 过滤
receipt 记录结果
```

---

## 30.3 最大用户风险

风险：

```text
错误旧记忆误导 Agent。
```

应对：

```text
支持 forget / supersede / expire
默认 recall 只返回 active
list_context 可审计
sourceRef 和 confidence 可追踪来源
```

---

## 30.4 最大落地风险

风险：

```text
过早做透明代理、provider auth、复杂 UI，导致项目失控。
```

应对：

```text
第一版只做 MCP tools + CLI
不处理 API key
不代理模型请求
不做 WebSocket interception
```

---

## 30.5 最大安全风险

风险：

```text
原文缓存和记忆中保存敏感信息。
```

应对：

```text
本地优先
可配置保留时间
支持 delete_original
支持 forget_context
receipt 不默认保存完整原文
```

---

# 31. 不做清单

第一版明确不做：

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
商业化付费系统
团队协作空间
```

---

# 32. 最小可验证版本

最小可验证版本分两步。

## Step 1：压缩闭环

完成：

```text
current_scope
compress_context
retrieve_original
ContentRouter
CompressedContextRecord
OriginalContentStore
Receipt
TokenStats
fail-open
```

验证：

```text
输入长测试日志
系统压缩关键错误
返回 originalRef
展示 tokens saved
可 retrieve 原文
压缩失败返回原文
```

---

## Step 2：记忆闭环

完成：

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
```

验证：

```text
保存 project_rule：本项目使用 pnpm
recall package manager 返回 pnpm
保存新规则：项目改用 bun
supersede 旧 pnpm 记忆
recall 默认只返回 bun
list_context 可看到旧记忆为 superseded
```

---

# 33. 最终结论

CodeContext MCP 值得继续推进。

它不应被设计成单纯压缩器，也不应被设计成单纯记忆服务。更准确的方向是：

```text
面向 AI Coding Agent 的本地上下文服务层。
```

其中：

```text
上下文压缩解决上下文过长
项目记忆解决跨会话遗忘和旧信息污染
scope 解决项目隔离
receipt 解决可审计
originalRef 解决压缩可恢复
profile 解决长期事实和近期任务分层
```

开发顺序应坚持：

```text
先压缩上下文
再项目记忆
最后智能化增强
```

第一轮最应该完成：

```text
current_scope
compress_context
retrieve_original
ContentRouter
receipt
token_stats
fail-open
```

第二轮必须完成：

```text
remember_context
recall_context
forget_context
list_context
repo_profile.static / dynamic
memory lifecycle
retrieval_receipt
```

不要第一版做：

```text
proxy
provider auth
云同步
复杂 UI
ML 压缩
图像压缩
自动修改项目文档
```

这个项目最强的展示点是：

```text
它不是简单压缩文本，也不是简单 MEMORY.md；
而是把压缩、原文可恢复、项目记忆、遗忘、召回、scope 隔离和 receipt 审计组合成一个可被 AI Coding Agent 调用的本地上下文服务层。
```

---

