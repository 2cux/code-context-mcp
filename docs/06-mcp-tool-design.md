# PRD §11：MCP Tool 设计

> 对应原 PRD.md 第 11 节。

---

## §11.1 current_scope

**目的**：识别当前项目 scope，用于隔离压缩缓存、原文、receipt、memory、profile。

**优先级**：P0

**输入**：
```json
{ "cwd": "/path/to/repo" }
```

**输出**：
```json
{
  "scopeId": "repo_8f3a91c2",
  "gitRoot": "/path/to/repo",
  "remote": "git@github.com:user/repo.git",
  "branch": "main",
  "scopeStrategy": "hash(gitRemote + gitRoot)"
}
```

**规则**：
- 优先 hash(git remote + git root path)
- 无 remote 时 hash(git root path)
- 非 git repo 时 hash(cwd)

**验收**：同一 repo scopeId 稳定，不同 repo scopeId 不同，scopeId 写入 receipt。

---

## §11.2 compress_context

**目的**：压缩长上下文，减少 token 消耗，保存原文并生成审计记录。

**优先级**：P0

**输入**：
```json
{
  "scopeId": "repo_8f3a91c2",
  "content": "long content here",
  "contentType": "test_output",
  "metadata": { "source": "pnpm test", "command": "pnpm test", "filePath": null },
  "strategy": "auto",
  "keepOriginal": true,
  "maxTokens": 2000,
  "timeoutMs": 5000
}
```

**成功输出**：
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

**失败输出**：
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

## §11.3 retrieve_original

**目的**：根据 originalRef 取回压缩前原文。

**优先级**：P0

**输入**：
```json
{
  "scopeId": "repo_8f3a91c2",
  "originalRef": "orig_01HXYZ",
  "offset": 0,
  "limit": 10000
}
```

**输出**：
```json
{
  "scopeId": "repo_8f3a91c2",
  "originalRef": "orig_01HXYZ",
  "contentType": "test_output",
  "content": "原始内容",
  "tokens": 30000,
  "metadata": { "source": "pnpm test", "command": "pnpm test" },
  "createdAt": "2026-06-09T10:00:00Z",
  "receiptId": "rcp_retrieve_01"
}
```

**规则**：只能在同 scope 下取回，大原文支持 offset/limit，retrieve 操作增加 retrieveCount 并生成 receipt。

---

## §11.4 get_receipt

**目的**：查看 compress / recall / remember / forget / retrieve 的审计记录。

**优先级**：P1

**输入**：`{ "receiptId": "rcp_01HXYZ" }`

**输出**：
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

## §11.5 list_compressions

**目的**：列出当前项目的压缩记录。

**优先级**：P1

**输入**：`{ "scopeId": "repo_8f3a91c2", "contentType": "test_output", "limit": 20, "offset": 0 }`

**输出**：
```json
{
  "scopeId": "repo_8f3a91c2",
  "items": [{ "ccrId": "ccr_01HXYZ", "contentType": "test_output", "summary": "...", "originalRef": "orig_01HXYZ", "tokensBefore": 30000, "tokensAfter": 1800, "tokensSaved": 28200, "retrieveCount": 1, "createdAt": "2026-06-09T10:00:00Z" }]
}
```

---

## §11.6 remember_context

**目的**：保存结构化项目记忆。

**优先级**：P1

**输入**：
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

**输出**：`{ "memoryId": "mem_01HXYZ", "scopeId": "...", "type": "project_rule", "status": "active", "receiptId": "rcp_mem_01" }`

**规则**：不传 scopeId 时使用 current_scope，默认 status=active，profileTarget=static 写入 repo_profile.static，=dynamic 写入 repo_profile.dynamic。

---

## §11.7 recall_context

**目的**：召回当前项目的 profile、相关记忆和必要的压缩上下文引用。

**优先级**：P1

**输入**：
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

**输出**：包含 profile（static + dynamic）、memories（含 score、canExpand）、relatedCompressedContexts、receiptId。

**规则**：默认只返回 active 记忆，默认返回 profile，superseded/forgotten/expired 默认不返回，每次 recall 必须生成 retrieval_receipt，没有结果也要生成。

---

## §11.8 forget_context

**目的**：遗忘、过期或替换项目记忆，防止旧信息污染 Agent。

**优先级**：P1

**输入**：
```json
{
  "id": "mem_01HXYZ",
  "mode": "supersede",
  "reason": "项目已从 npm 迁移到 pnpm。",
  "supersededBy": "mem_02HXYZ"
}
```

**mode 说明**：
- `soft_forget` — 标记为 forgotten
- `supersede` — 标记为 superseded，关联新记忆
- `expire` — 标记为 expired
- `hard_delete` — 保留接口，默认不开放或需要 confirm

**输出**：`{ "memoryId": "...", "previousStatus": "active", "newStatus": "superseded", "supersededBy": "mem_02HXYZ", "receiptId": "rcp_forget_01" }`

---

## §11.9 list_context

**目的**：列出当前项目记忆，用于审计、清理和调试 recall。

**优先级**：P1

**输入**：`{ "scopeId": "repo_8f3a91c2", "types": ["project_rule"], "status": ["active"], "limit": 50, "offset": 0 }`

**输出**：
```json
{
  "scopeId": "repo_8f3a91c2",
  "items": [{ "id": "mem_01HXYZ", "type": "project_rule", "summary": "...", "status": "active", "sourceRef": "user:manual", "confidence": 0.95, "createdAt": "...", "updatedAt": "..." }],
  "total": 1
}
```
