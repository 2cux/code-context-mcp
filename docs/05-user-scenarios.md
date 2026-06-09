# PRD §10：核心用户场景

> 对应原 PRD.md 第 10 节。

---

## §10.1 场景一：压缩测试日志

用户让 Agent 跑测试，输出 30000 tokens。

Agent 调用 `compress_context(contentType="test_output", content="...")`，系统返回：

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

Agent 如需完整日志，调用 `retrieve_original(originalRef)`。

---

## §10.2 场景二：压缩代码文件

Agent 读取 2000 行 TypeScript 文件，系统压缩为：

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

要求：不改写代码、不删除 public API、不删除类型定义、不删除错误相关块。

---

## §10.3 场景三：压缩 RAG chunks

一次检索返回多个 chunks，系统压缩为：

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

## §10.4 场景四：保存项目规则

用户告诉 Agent "本项目使用 pnpm，不要使用 npm。" Agent 调用：

```text
remember_context(type="project_rule", content="本项目使用 pnpm，不要使用 npm。", profileTarget="static")
```

后续用户说"帮我安装 zod"，Agent 调用 `recall_context(query="package manager install dependency")`，系统返回 `repo_profile.static: 本项目使用 pnpm，不要使用 npm。`，Agent 应使用 `pnpm add zod`。

---

## §10.5 场景五：旧记忆替换

旧记忆："本项目使用 npm。" → 新记忆："本项目已迁移到 pnpm。"

Agent 或用户调用：

```text
forget_context(id="mem_old", mode="supersede", supersededBy="mem_new")
```

后续 recall 默认不再返回旧 npm 记忆。

---

## §10.6 场景六：继续上次任务

记忆：`current_task: 正在修 auth/session.ts 中 refresh token 过期后没有清理 cookie 的问题。`

新会话中 Agent 调用 `recall_context(query="continue previous auth task")`，返回：

```text
repo_profile.dynamic
current_task
related test_failure
related compressed log
```

---

## §10.7 场景七：审计记忆和压缩记录

用户调用：

```text
list_context(types=["project_rule"], status=["active"])
list_compressions(contentType="test_output")
get_receipt(receiptId)
```

用于：检查错误记忆、清理过期记忆、查看压缩是否有效、确认 recall 是否发生。

---

## §10.8 场景八：repo scope 隔离

repo A 使用 pnpm，repo B 使用 uv。

在 repo A 中 recall "package manager"，只能返回 repo A 的 pnpm，不得返回 repo B 的 uv。
