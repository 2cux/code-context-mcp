-- =============================================================================
-- CodeContext MCP — SQLite Schema
-- All tables are scoped by repo (scope_id).
-- Timestamps stored as ISO 8601 strings.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Scopes — repo scope resolution records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scopes (
    scope_id       TEXT PRIMARY KEY,
    git_root       TEXT,
    remote         TEXT,
    branch         TEXT,
    cwd            TEXT NOT NULL,
    scope_strategy TEXT NOT NULL CHECK (scope_strategy IN (
                        'gitRemote+gitRoot', 'gitRootOnly', 'cwdFallback'
                    )),
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 2. Compressed Contexts — every compression produces one row
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compressed_contexts (
    id                    TEXT PRIMARY KEY,
    scope_id              TEXT NOT NULL,
    content_type          TEXT NOT NULL CHECK (content_type IN (
                              'test_output', 'log', 'command_output',
                              'code', 'json', 'markdown', 'plain_text',
                              'rag_chunk', 'file_summary',
                              'conversation_history', 'unknown'
                          )),
    strategy              TEXT NOT NULL,
    compressed_content    TEXT NOT NULL,
    summary               TEXT,
    original_ref          TEXT,
    source_ref            TEXT,
    metadata              TEXT,  -- JSON string
    tokens_before         INTEGER NOT NULL,
    tokens_after          INTEGER NOT NULL,
    tokens_saved          INTEGER NOT NULL,
    compression_ratio     REAL NOT NULL,
    can_retrieve_original INTEGER NOT NULL DEFAULT 1,
    retrieve_count        INTEGER NOT NULL DEFAULT 0,
    failed                INTEGER NOT NULL DEFAULT 0,
    error_reason          TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL,
    expires_at            TEXT,
    FOREIGN KEY (scope_id) REFERENCES scopes(scope_id)
);

CREATE INDEX IF NOT EXISTS idx_ccr_scope       ON compressed_contexts(scope_id);
CREATE INDEX IF NOT EXISTS idx_ccr_type        ON compressed_contexts(content_type);
CREATE INDEX IF NOT EXISTS idx_ccr_created     ON compressed_contexts(created_at);
CREATE INDEX IF NOT EXISTS idx_ccr_original_ref ON compressed_contexts(original_ref);

-- ---------------------------------------------------------------------------
-- 3. Original Contents — full original content cached for later retrieval
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS original_contents (
    id           TEXT PRIMARY KEY,
    scope_id     TEXT NOT NULL,
    ccr_id       TEXT NOT NULL,
    content_type TEXT NOT NULL,
    content      TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    tokens       INTEGER NOT NULL,
    metadata     TEXT,  -- JSON string
    created_at   TEXT NOT NULL,
    expires_at   TEXT,
    FOREIGN KEY (scope_id) REFERENCES scopes(scope_id),
    FOREIGN KEY (ccr_id)   REFERENCES compressed_contexts(id)
);

CREATE INDEX IF NOT EXISTS idx_orig_scope   ON original_contents(scope_id);
CREATE INDEX IF NOT EXISTS idx_orig_ccr     ON original_contents(ccr_id);
CREATE INDEX IF NOT EXISTS idx_orig_hash    ON original_contents(content_hash);

-- ---------------------------------------------------------------------------
-- 4. Memories — structured project memory records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memories (
    id            TEXT PRIMARY KEY,
    scope_id      TEXT NOT NULL,
    type          TEXT NOT NULL CHECK (type IN (
                       'decision', 'bug', 'command', 'file_summary',
                       'project_rule', 'user_preference', 'current_task',
                       'test_failure', 'api_contract', 'dependency'
                   )),
    content       TEXT NOT NULL,
    summary       TEXT,
    source_ref    TEXT,
    confidence    REAL NOT NULL DEFAULT 0.8,
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
                       'active', 'superseded', 'forgotten', 'expired'
                   )),
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    expires_at    TEXT,
    superseded_by TEXT,
    tags          TEXT,  -- JSON array string
    FOREIGN KEY (scope_id) REFERENCES scopes(scope_id)
);

CREATE INDEX IF NOT EXISTS idx_mem_scope   ON memories(scope_id);
CREATE INDEX IF NOT EXISTS idx_mem_type    ON memories(type);
CREATE INDEX IF NOT EXISTS idx_mem_status  ON memories(status);
CREATE INDEX IF NOT EXISTS idx_mem_created ON memories(created_at);

-- ---------------------------------------------------------------------------
-- 5. Memories FTS — full-text search via LIKE (Phase 5)
--
--    NOTE: FTS5 virtual table is NOT created by default because the
--    sql.js default WASM build does not include the FTS5 extension.
--    When we need FTS5, we will either:
--      a) build a custom sql.js WASM with FTS5 enabled, or
--      b) use the wa-sqlite package which supports FTS5.
--    For Phase 5, recall_context will use LIKE-based search on
--    memories.summary and memories.content as a fallback.
-- ---------------------------------------------------------------------------
-- (FTS5 virtual table creation skipped — see note above.)

-- ---------------------------------------------------------------------------
-- 6. Profile Facts — repo_profile.static and repo_profile.dynamic
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profile_facts (
    id               TEXT PRIMARY KEY,
    scope_id         TEXT NOT NULL,
    layer            TEXT NOT NULL CHECK (layer IN ('static', 'dynamic')),
    content          TEXT NOT NULL,
    source_memory_id TEXT,
    source_ref       TEXT,
    confidence       REAL NOT NULL DEFAULT 0.8,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    expires_at       TEXT,
    FOREIGN KEY (scope_id)         REFERENCES scopes(scope_id),
    FOREIGN KEY (source_memory_id) REFERENCES memories(id)
);

CREATE INDEX IF NOT EXISTS idx_pf_scope ON profile_facts(scope_id);
CREATE INDEX IF NOT EXISTS idx_pf_layer ON profile_facts(layer);

-- ---------------------------------------------------------------------------
-- 7. Receipts — audit trail for compress/retrieve/remember/recall/forget
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS receipts (
    id                  TEXT PRIMARY KEY,
    operation           TEXT NOT NULL CHECK (operation IN (
                            'compress', 'retrieve_original', 'delete_original',
                            'cleanup_originals', 'remember',
                            'recall', 'forget', 'list'
                        )),
    scope_id            TEXT NOT NULL,
    input_hash          TEXT,
    query               TEXT,
    result_ids          TEXT,  -- JSON array string
    memory_ids          TEXT,  -- JSON array string
    ccr_ids             TEXT,  -- JSON array string
    original_refs       TEXT,  -- JSON array string
    tokens_before       INTEGER,
    tokens_after        INTEGER,
    tokens_saved        INTEGER,
    compression_ratio   REAL,
    compressed          INTEGER,
    retrieved_original  INTEGER,
    failed              INTEGER DEFAULT 0,
    error_reason        TEXT,
    timestamp           TEXT NOT NULL,
    FOREIGN KEY (scope_id) REFERENCES scopes(scope_id)
);

CREATE INDEX IF NOT EXISTS idx_rcp_scope     ON receipts(scope_id);
CREATE INDEX IF NOT EXISTS idx_rcp_operation ON receipts(operation);
CREATE INDEX IF NOT EXISTS idx_rcp_time      ON receipts(timestamp);
