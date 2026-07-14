# AGENTS.md

## Project

This project is **CodeContext MCP**.

It is a local-first MCP server for AI coding agents.

The project has two equally important goals:

1. Compress long coding context.
2. Provide project-scoped memory.

Do not treat this as only a compression tool or only a memory tool.  
It is a local context layer for AI coding agents.

---

## Core Idea

AI coding agents often have two problems:

1. Context gets too long.
2. Project knowledge gets forgotten or polluted by outdated information.

CodeContext MCP should help with both.

It should:

- Compress long logs, command outputs, code files, RAG chunks, and conversation history.
- Preserve original content so compressed context can be expanded later.
- Track token savings and compression results.
- Store useful project memory.
- Recall relevant project context when needed.
- Forget, expire, or supersede outdated memory.
- Keep everything isolated by repository scope.
- Make important operations auditable through receipts.

---

## Development Order

The product has two core capabilities, but build them in this order:

1. Context compression first.
2. Project memory second.
3. Integration between compression and memory third.
4. Intelligent features later.

This does not mean memory is less important.  
It only means compression is the better first development milestone.

---

## First Version Priorities

Focus on:

- MCP server setup
- `current_scope`
- `compress_context`
- `retrieve_original`
- content type detection
- compressed context records
- original content storage
- token statistics
- receipts
- timeout, size limit, chunking, and fail-open behavior
- local SQLite storage
- simple CLI for testing

Compression must be safe. If compression fails, return the original content instead of blocking the agent.

---

## Second Version Priorities

After the compression flow works, add:

- `remember_context`
- `recall_context`
- `forget_context`
- `list_context`
- typed memory records
- memory lifecycle: `active`, `superseded`, `forgotten`, `expired`
- repo profile split into `static` and `dynamic`
- retrieval receipts
- basic local retrieval using SQLite FTS or similar

Memory must be scoped, typed, auditable, and forgettable.  
Do not implement memory as only a static `MEMORY.md`.

---

## Important Design Principles

- Local-first by default.
- Do not upload project code, logs, memory, or original content.
- Scope everything by repository.
- Compression must preserve important error details.
- Code compression must be conservative.
- Original content should be recoverable when available.
- Receipts should prove what happened without storing unnecessary private content.
- Old memory must not silently pollute future recall.
- Prefer explicit MCP tools before any proxy or automation layer.

---

## Avoid in the First Version

Do not build these early:

- transparent HTTP proxy
- WebSocket provider interception
- multi-provider auth
- cloud sync
- OAuth connectors
- complex UI
- image compression
- ML-based compression
- automatic modification of `AGENTS.md` or `AGENTS.md`
- multi-user permission system

These may be considered later only if the core MCP flow is already stable.

---

## Documentation

产品设计、功能范围、开发规划相关疑问查 [docs/INDEX.md](./docs/INDEX.md)。

---

## Naming

Use:

```text
CodeContext MCP