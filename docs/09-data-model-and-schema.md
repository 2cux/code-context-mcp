# PRD §15–17：数据模型、SQLite 表设计与本地存储

> 对应原 PRD.md 第 15–17 节。

---

## §15. 数据模型

### §15.1 ScopeRecord

```ts
type ScopeRecord = {
  scopeId: string
  gitRoot?: string
  remote?: string
  branch?: string
  cwd: string
  scopeStrategy: "gitRemote+gitRoot" | "gitRootOnly" | "cwdFallback"
  createdAt: string
  updatedAt: string
}
```

### §15.2 CompressedContextRecord (CCR)

```ts
type CompressedContextRecord = {
  id: string
  scopeId: string
  contentType: "test_output" | "log" | "command_output" | "code" | "json"
    | "markdown" | "plain_text" | "rag_chunk" | "file_summary"
    | "conversation_history" | "unknown"
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

### §15.3 OriginalContentRecord

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

### §15.4 MemoryRecord

```ts
type MemoryRecord = {
  id: string
  scopeId: string
  type: "decision" | "bug" | "command" | "file_summary" | "project_rule"
    | "user_preference" | "current_task" | "test_failure"
    | "api_contract" | "dependency"
  content: string
  summary?: string
  sourceRef?: string
  confidence: number
  status: "active" | "superseded" | "forgotten" | "expired"
  createdAt: string
  updatedAt: string
  expiresAt?: string
  supersedes?: string[]
  supersededBy?: string
  tags?: string[]
}
```

### §15.5 RepoProfile

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

### §15.6 Receipt

统一 receipt，覆盖压缩和记忆：

```ts
type Receipt = {
  id: string
  operation: "compress" | "retrieve_original" | "remember"
    | "recall" | "forget" | "list"
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

## §16. SQLite 表设计

### scopes
```sql
CREATE TABLE scopes (
  scope_id TEXT PRIMARY KEY,
  git_root TEXT, remote TEXT, branch TEXT,
  cwd TEXT NOT NULL,
  scope_strategy TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
```

### compressed_contexts
```sql
CREATE TABLE compressed_contexts (
  id TEXT PRIMARY KEY, scope_id TEXT NOT NULL,
  content_type TEXT NOT NULL, strategy TEXT NOT NULL,
  compressed_content TEXT NOT NULL, summary TEXT,
  original_ref TEXT, source_ref TEXT, metadata TEXT,
  tokens_before INTEGER NOT NULL, tokens_after INTEGER NOT NULL,
  tokens_saved INTEGER NOT NULL, compression_ratio REAL NOT NULL,
  can_retrieve_original INTEGER NOT NULL DEFAULT 1,
  retrieve_count INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0, error_reason TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT,
  FOREIGN KEY (scope_id) REFERENCES scopes(scope_id)
);
```

### original_contents
```sql
CREATE TABLE original_contents (
  id TEXT PRIMARY KEY, scope_id TEXT NOT NULL,
  ccr_id TEXT NOT NULL, content_type TEXT NOT NULL,
  content TEXT NOT NULL, content_hash TEXT NOT NULL,
  tokens INTEGER NOT NULL, metadata TEXT,
  created_at TEXT NOT NULL, expires_at TEXT,
  FOREIGN KEY (scope_id) REFERENCES scopes(scope_id),
  FOREIGN KEY (ccr_id) REFERENCES compressed_contexts(id)
);
```

### memories
```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY, scope_id TEXT NOT NULL,
  type TEXT NOT NULL, content TEXT NOT NULL, summary TEXT,
  source_ref TEXT, confidence REAL NOT NULL DEFAULT 0.8,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  expires_at TEXT, superseded_by TEXT, tags TEXT,
  FOREIGN KEY (scope_id) REFERENCES scopes(scope_id)
);
```

### memories_fts
```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
  id UNINDEXED, scope_id UNINDEXED, type UNINDEXED,
  summary, content, source_ref
);
```

### profile_facts
```sql
CREATE TABLE profile_facts (
  id TEXT PRIMARY KEY, scope_id TEXT NOT NULL,
  layer TEXT NOT NULL, content TEXT NOT NULL,
  source_memory_id TEXT, source_ref TEXT,
  confidence REAL NOT NULL DEFAULT 0.8,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT,
  FOREIGN KEY (scope_id) REFERENCES scopes(scope_id),
  FOREIGN KEY (source_memory_id) REFERENCES memories(id)
);
```

### receipts
```sql
CREATE TABLE receipts (
  id TEXT PRIMARY KEY, operation TEXT NOT NULL, scope_id TEXT NOT NULL,
  input_hash TEXT, query TEXT, result_ids TEXT, memory_ids TEXT,
  ccr_ids TEXT, original_refs TEXT,
  tokens_before INTEGER, tokens_after INTEGER, tokens_saved INTEGER,
  compression_ratio REAL, compressed INTEGER,
  retrieved_original INTEGER, failed INTEGER DEFAULT 0, error_reason TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (scope_id) REFERENCES scopes(scope_id)
);
```

---

## §17. 本地存储结构

默认目录：`~/.code-context-mcp/`

建议结构：

```text
~/.code-context-mcp/
  code-context.sqlite     # 结构化数据
  originals/              # 大原文缓存
  logs/                   # 工具自身运行日志
  config.json             # 本地配置
```
