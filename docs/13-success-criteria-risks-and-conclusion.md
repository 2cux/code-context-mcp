# PRD §29–33：成功标准、风险分析与最终结论

> 对应原 PRD.md 第 29–33 节。

---

## §29. 成功标准

### §29.1 MVP 成功标准

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

### §29.2 V1 成功标准

```text
remember_context 可保存项目记忆
recall_context 可召回相关记忆
forget_context 可 supersede / expire / forget
list_context 可审计
repo_profile.static / dynamic 可返回
retrieval_receipt 可证明 recall 行为
memory 与 compressed context 可通过 sourceRef 关联
```

### §29.3 用户价值成功标准

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

### §29.4 作品集成功标准

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

## §30. 风险分析

### §30.1 最大产品风险
**风险**：压缩和记忆两个方向都重要，容易做成大而全。
**应对**：产品定位双核心，开发顺序分阶段，MVP 先压缩 V1 补记忆，数据模型提前兼容。

### §30.2 最大技术风险
**风险**：压缩质量不稳定，召回质量不稳定。
**应对**：保守压缩策略、代码不改写语义、原文可 retrieve、type/status/confidence/scope 过滤、receipt 记录。

### §30.3 最大用户风险
**风险**：错误旧记忆误导 Agent。
**应对**：支持 forget/supersede/expire，默认只返回 active，list_context 可审计，sourceRef 和 confidence 可追踪。

### §30.4 最大落地风险
**风险**：过早做透明代理、provider auth、复杂 UI，导致项目失控。
**应对**：第一版只做 MCP tools + CLI，不处理 API key，不代理模型请求，不做 WebSocket interception。

### §30.5 最大安全风险
**风险**：原文缓存和记忆中保存敏感信息。
**应对**：本地优先，可配置保留时间，支持 delete_original 和 forget_context，receipt 不默认保存完整原文。

---

## §31. 不做清单

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

## §32. 最小可验证版本

分两步。

**Step 1：压缩闭环**
完成：current_scope、compress_context、retrieve_original、ContentRouter、CCR、OriginalContentStore、Receipt、TokenStats、fail-open
验证：输入长测试日志 → 压缩关键错误 → 返回 originalRef → tokens saved → 可 retrieve 原文 → 压缩失败返回原文

**Step 2：记忆闭环**
完成：remember_context、recall_context、forget_context、list_context、MemoryRecord、Memory lifecycle、repo_profile.static/dynamic、retrieval_receipt
验证：保存 project_rule → recall 返回 → supersede 旧记忆 → recall 默认只返回新记忆 → list_context 可审计

---

## §33. 最终结论

CodeContext MCP 值得继续推进。它不应被设计成单纯压缩器，也不应被设计成单纯记忆服务。更准确的方向是：

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

开发顺序：

```text
先压缩上下文 → 再项目记忆 → 最后智能化增强
```

第一轮最应完成：current_scope、compress_context、retrieve_original、ContentRouter、receipt、token_stats、fail-open

第二轮必须完成：remember_context、recall_context、forget_context、list_context、repo_profile.static/dynamic、memory lifecycle、retrieval_receipt

不要第一版做：proxy、provider auth、云同步、复杂 UI、ML 压缩、图像压缩、自动修改项目文档

**这个项目最强的展示点是：**

```text
它不是简单压缩文本，也不是简单 MEMORY.md；
而是把压缩、原文可恢复、项目记忆、遗忘、召回、scope 隔离和 receipt 审计
组合成一个可被 AI Coding Agent 调用的本地上下文服务层。
```
