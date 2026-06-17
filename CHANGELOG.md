# Changelog

All notable changes to CodeContext MCP.

## [1.0.0-rc] — 2026-06-17

### Release Candidate

Third major iteration after alpha (v0.1.0) and beta (v0.2.0). RC hardening phase — no new features, only quality, safety, and release readiness.

### Added
- `MCP_TOOL_MODE` env var with `agent` (7 tools), `dev` (18 tools), `test` (18 tools)
- `run_context_flow` — unified agent-facing compression + memory pipeline
- `analyze_context` — context decision intelligence
- `failure_stats` / `list_failures` — failure learning diagnostics
- Harness MCP tools (4): `run_harness_flow`, `list_harness_flows`, `check_harness_flow`, `get_harness_run`
- Memory guard: auto-skip/sample extreme perf tests based on system memory
- Cache warm analysis with cold/warm split thresholds
- Schema version tracking (`PRAGMA user_version`) for migration optimization
- Tool mode security regression test suite (60 tests)
- Live agent validation (12 scenarios)
- Clean install smoke test script
- `docs/PERFORMANCE.md`, `docs/releases/v0.3.0-rc.md`

### Changed
- Default mode is `agent` (7 safe tools). Dangerous tools hidden from AI agents.
- Real MCP adapter uses shared `toolRegistry.ts` (was stub)
- Performance reports split into cold-start / warm categories
- Extreme perf tests auto-degrade: skip (<8GB), sample (8–16GB), full (≥16GB)
- `initAndMigrate()` skips redundant migration runs when schema is current
- Tool count updated to 18 across all documentation

### Fixed
- Real MCP adapter now supports all 18 tools via shared registry
- `describeMode` dev count corrected to 18
- `npm pack --dry-run` verification in clean-install smoke
- Harness tools correctly filtered from agent mode tool listing

## [1.0.0] — 2025-06-14

### Stable Release

First stable release after alpha and beta cycles. Core features are production-ready.

### Features

#### Context Compression
- `compress_context` — Compress 9 content types: test output, logs, command output, code, JSON, markdown, RAG chunks, conversation history, plain text
- `retrieve_original` — Retrieve original content from compressed reference
- `list_compressions` — List recent compression records
- `delete_original` / `cleanup_originals` — Manage stored originals
- `current_scope` — Resolve and report current repository scope
- `get_stats` — View token savings and compression statistics
- Automatic content type detection via ContentRouter (8 detectors)

#### Project Memory
- `remember_context` — Store typed, scoped project memory
- `recall_context` — Search and retrieve relevant memories via SQLite FTS
- `forget_context` — Soft-forget, supersede, expire, or hard-delete memories
- `list_context` — List memories with type and status filters
- `get_profile` — View repo profile (static + dynamic layers)

#### Safety & Audit
- Fail-open: if compression fails, original content is returned
- Timeout, size limit, and chunking for large inputs
- Receipt trail for all major operations via `list_receipts`
- Repository-scoped isolation via git remote + root hash

### Technical
- 904 tests passing
- Node.js ≥ 18.0.0
- SQLite local storage (`~/.code-context-mcp/`)
- MCP SDK `@modelcontextprotocol/sdk`
- TypeScript with full type definitions
- CLI with comprehensive commands

## [0.2.0-beta] — 2025-05

### Added
- Project memory system: `remember_context`, `recall_context`, `forget_context`, `list_context`
- Repo profile with `static` and `dynamic` layers
- Memory lifecycle: active, superseded, forgotten, expired
- SQLite FTS for memory recall
- `list_receipts` for audit trail
- Memory source reference tracking

## [0.1.0-alpha] — 2025-04

### Added
- Initial release: context compression only
- 9 compression strategies
- Content type auto-detection
- Original content storage
- Token statistics
- CLI for testing
- MCP server (stdio transport)
