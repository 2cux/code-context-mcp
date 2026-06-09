# PRD §2–4：产品背景与定位

> 对应原 PRD.md 第 2–4 节。

---

## §2. 产品背景

AI Coding Agent 在真实项目开发中会遇到两类核心上下文问题。

**第一类：上下文太长。**

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

**第二类：项目上下文会被遗忘，也会被旧信息污染。**

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

因此，本项目要解决的不是单一的"压缩问题"，也不是单一的"记忆问题"，而是构建一个面向 AI Coding Agent 的本地上下文服务层：

```text
压缩上下文，减少 token 浪费
保存原文，保证可恢复
记录 receipt，保证可审计
按 repo scope 隔离，避免项目污染
保存重要项目上下文，支持召回和遗忘
用 profile 区分长期稳定事实和近期动态任务
```

---

## §3. 产品定位

### §3.1 一句话定位

CodeContext MCP 是一个本地优先的 MCP 上下文服务层，为 AI Coding Agent 提供上下文压缩、原文取回、token 统计、项目级记忆、可控召回、可遗忘和可审计能力。

### §3.2 产品本质

本项目同时包含两个核心子系统：

```text
Context Compression Layer
Project Memory Layer
```

二者同等重要，但职责不同。

**Context Compression Layer** 负责：

```text
识别上下文类型
压缩工具输出、日志、代码、RAG chunks
减少 token 消耗
保存原文
支持 retrieve_original
记录 tokens saved
保证压缩失败不影响 Agent
```

**Project Memory Layer** 负责：

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

### §3.3 产品不是

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

### §3.4 产品价值排序

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

## §4. 目标用户

### §4.1 核心用户

**用户 1：高频 AI Coding Agent 用户**

特征：每天使用 Claude Code / Cursor / OpenCode / Codex CLI，经常让 Agent 读文件、跑测试、看日志、改代码，经常遇到上下文过长，经常需要延续上一轮任务。

核心需求：压缩长上下文、保留关键错误信息、让 Agent 记住项目规则和历史任务、避免每次重复解释。

**用户 2：多项目开发者**

特征：同时维护多个 repo，不同 repo 技术栈、包管理器、历史问题不同。

核心需求：repo scope 隔离，当前项目记忆只在当前项目召回，当前项目压缩缓存只在当前项目可取回。

**用户 3：关注上下文成本和 Agent 可靠性的开发者**

特征：关心 token 消耗、上下文窗口利用率、Agent 是否被旧信息误导、压缩和召回是否可验证。

核心需求：tokensBefore / tokensAfter / tokensSaved、compression receipt、retrieval receipt、list_context、forget_context、retrieve_original。

**用户 4：希望做 AI Agent / MCP 作品集项目的开发者**

特征：希望项目体现 MCP 能力、context engineering 能力、可靠性、数据建模能力，边界清晰、能落地、能演示。

核心需求：清晰产品定位、真实痛点、可执行 MVP、技术亮点明确、不做过度设计。

### §4.2 非目标用户

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
