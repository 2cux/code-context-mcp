# CodeContext MCP — Security

Security model, data handling, privacy guarantees, and risk mitigation.

---

## Table of Contents

- [Core Principle: Local-First](#core-principle-local-first)
- [Data Directory](#data-directory)
- [What We Store](#what-we-store)
- [What We Never Store](#what-we-never-store)
- [Original Content Caching](#original-content-caching)
- [Deleting Original Content](#deleting-original-content)
- [Cleaning Up Expired Data](#cleaning-up-expired-data)
- [Scope Isolation](#scope-isolation)
- [API Keys & Secrets](#api-keys--secrets)
- [Network & Telemetry](#network--telemetry)
- [Attack Surface](#attack-surface)
- [Security Recommendations](#security-recommendations)

---

## Core Principle: Local-First

**CodeContext MCP never sends your data anywhere.** All data is stored in a local SQLite database on your machine. There is no cloud backend, no API endpoint, no telemetry, no analytics. The server communicates only over local stdio with your AI coding agent.

```
┌──────────────────┐     stdio (local)     ┌──────────────────┐
│  AI Coding Agent │ ◄──────────────────► │ CodeContext MCP   │
└──────────────────┘                       │     Server        │
                                           │  ┌─────────────┐ │
                                           │  │   SQLite     │ │
                                           │  │  (local DB)  │ │
                                           │  └─────────────┘ │
                                           └──────────────────┘
```

---

## Data Directory

All persistent data is stored in a single directory:

```
~/.code-context-mcp/
├── code-context.sqlite    # Main database (all tables)
└── code-context.sqlite.journal  # SQLite WAL journal (during writes)
```

- **Windows**: `C:\Users\<username>\.code-context-mcp\`
- **macOS**: `/Users/<username>/.code-context-mcp/`
- **Linux**: `/home/<username>/.code-context-mcp/`

The directory is created automatically on first use. The database file contains all scopes, compressions, original content, memories, profile facts, and receipts.

---

## What We Store

| Data | Stored In | Contains |
|---|---|---|
| Scope identifiers | `scopes` | Git remote URL, git root path, branch name, working directory |
| Compressed content | `compressed_contexts` | Compressed/summarized versions of your content |
| Original content | `original_contents` | Full original content (only when `keepOriginal: true`) |
| Content hashes | `original_contents`, `receipts` | SHA-256 hash of original content (not reversible) |
| Memory entries | `memories` | Project rules, decisions, tasks — whatever you choose to remember |
| Profile facts | `profile_facts` | Summarized static/dynamic project knowledge |
| Operation receipts | `receipts` | Operation type, timestamps, token stats, result IDs, hashes |

---

## What We Never Store

CodeContext MCP explicitly does NOT store:

- **API keys, tokens, or passwords** — The compressor is designed to fold/redact credential-like patterns, but this is based on heuristics, not cryptographic guarantees. Never pass API keys in content you compress.
- **Environment variables** — Not read, not stored, not included in scope resolution beyond `cwd`.
- **Authentication data** — No OAuth tokens, session cookies, or login credentials.
- **User identity** — No concept of "user" exists. Data is scoped by repository, not by person.
- **Network traffic** — No HTTP proxy, no WebSocket interception, no packet capture.

---

## Original Content Caching

### Risk

When `compress_context` is called with `keepOriginal: true` (the default), the full original content is saved to the `original_contents` table in the local SQLite database. This means:

- Test output containing file paths, function names, variable values
- Logs containing IP addresses, hostnames, timestamps
- Code files with your proprietary logic
- Conversation history with your AI agent

...are all stored in plaintext in a local SQLite file.

### Mitigation

1. **`keepOriginal: false`**: Disable original caching when compressing sensitive content
   ```bash
   pnpm cli compress sensitive.log --no-keep-original
   ```

2. **`cleanup_originals`**: Remove expired originals periodically
   ```bash
   pnpm cli cleanup --originals
   ```

3. **`delete_original`**: Delete specific originals by ref
   ```bash
   pnpm cli retrieve orig_xxxxxxxx  # verify content first
   pnpm cli delete orig_xxxxxxxx    # then delete
   ```

4. The original content is NOT included in compression receipts — receipts only contain content hashes and token counts.

---

## Deleting Original Content

### By Ref (single)

```bash
# Via CLI
pnpm cli delete orig_xxxxxxxx
```

```json
// Via MCP tool
{ "tool": "delete_original", "scopeId": "...", "originalRef": "orig_xxxxxxxx" }
```

This:
- Deletes the row from `original_contents`
- Updates the CCR's `can_retrieve_original` to 0
- Creates a receipt for audit

### By Cleanup (batch)

```bash
# Via CLI
pnpm cli cleanup --originals
```

This:
- Removes all `original_contents` rows where `expires_at < NOW`
- For each affected CCR with no remaining originals, sets `can_retrieve_original = 0`
- Creates a receipt

### Permanent Deletion

SQLite deletion does NOT securely erase data from disk. Deleted rows may remain in the database file until the database is VACUUMed:

```bash
sqlite3 ~/.code-context-mcp/code-context.sqlite "VACUUM;"
```

For truly sensitive data, use file-level secure deletion tools for your OS.

---

## Cleaning Up Expired Data

There is no automatic expiration daemon. You must explicitly run:

```bash
pnpm cli cleanup --originals
```

Manual expiration can be done:
- **Memories**: `pnpm cli forget <id> --mode expire`
- **Original content**: Set `expiresAt` during compression (not yet exposed in CLI)

All forgotten/superseded/expired memories remain in the database (soft deletion) unless `hard_delete` is used.

---

## Scope Isolation

Each repository gets a unique `scopeId` based on:

```
scopeId = "repo_" + SHA256(gitRemote + gitRoot)[0:8]
```

This means:

- **Data from one repo is invisible in another repo**
- **All SQL queries filter by `scope_id`**
- **Cross-scope access attempts are explicitly rejected** with `scope_mismatch` errors
- **Receipts are also scope-scoped** — each repo has its own audit trail

**Limitation**: If two repos have the same `gitRemote + gitRoot` path (same machine, same clone), they share the same `scopeId`. This is by design — it's the same project. If you need isolation between different checkouts of the same repo, use `cwd` override.

**Scope strategy fallback**: When not in a git repo, the hash is of `cwd`. When git is available but no remote, the hash is of `gitRoot`. This means:
- Two checkouts of the same repo with different remotes → different scopes
- A git-less directory → scope based on absolute path
- Moving a repo directory → same `scopeId` (based on remote URL)

---

## API Keys & Secrets

### Do NOT pass API keys through compression

The compressor does NOT have cryptographic secret detection. Its credential-folding is regex-based and may miss:
- Credentials in non-standard formats
- Keys embedded in JSON or YAML
- Short-lived tokens

Before compressing content, strip API keys client-side.

### Receipts use content hashes, not content

Receipts store `inputHash` (SHA-256 of the original content), not the content itself. This proves "this operation happened on this content" without storing the content in the receipt.

### No API keys in CodeContext itself

CodeContext MCP does not use any API keys, auth tokens, or cloud credentials. It has no external dependencies at runtime beyond the bundled npm packages.

---

## Network & Telemetry

CodeContext MCP makes **zero network calls**:

| Component | Network? |
|---|---|
| MCP server | No — stdio only |
| SQLite | No — local file |
| Token counting (tiktoken) | No — local WASM |
| Compression strategies | No — pure JS |
| Receipts | No — local DB |
| CLI | No — local process |

There is no telemetry, no analytics, no crash reporting, and no update checking.

The only "network" interaction is that git commands (`git remote get-url origin`, `git rev-parse`) read from the local git config. These are local reads, not network calls.

---

## Attack Surface

### MCP stdio transport

The server accepts JSON-RPC messages over stdin from the AI agent process. An attacker who can inject messages into the agent's stdin could:
- Trigger compression on arbitrary content
- Read back compressed content
- Write/read/delete memories
- View receipts

**Mitigation**: The AI agent is the only process that should have access to the server's stdin/stdout. MCP servers run as child processes of the agent.

### SQLite injection

All queries use parameterized statements (`?` placeholders). The only dynamic SQL construction is:
- `ORDER BY` columns (whitelisted against known column names)
- `IN (...)` clauses (parameterized with `?` for each value)

No user input is ever concatenated directly into SQL strings.

### Database file access

The database file is protected by OS file permissions. Anyone with read access to `~/.code-context-mcp/` can read all stored data.

**Mitigation**: Ensure your home directory permissions are appropriate. On multi-user systems, `chmod 700 ~/.code-context-mcp/`.

### Supply chain

Dependencies:
- `@modelcontextprotocol/sdk` — Anthropic's MCP SDK
- `sql.js` — SQLite compiled to WASM
- `tiktoken` — OpenAI's tokenizer

All are well-known packages. Run `pnpm audit` periodically to check for vulnerabilities.

---

## Security Recommendations

1. **Keep the database directory private**: `chmod 700 ~/.code-context-mcp/` on macOS/Linux
2. **Disable original caching for sensitive content**: Use `keepOriginal: false`
3. **Regularly clean expired originals**: `pnpm cli cleanup --originals`
4. **Use `hard_delete` for truly sensitive memories** (soft_forget leaves data in DB)
5. **Strip API keys before compression**: The compressor is not a secret scanner
6. **VACUUM after bulk deletions**: SQLite doesn't reclaim space automatically
7. **Run `pnpm audit`**: Check for dependency vulnerabilities
8. **Backup the database**: `cp ~/.code-context-mcp/code-context.sqlite ~/backup/` before upgrades
9. **Delete the database to start fresh**: `rm ~/.code-context-mcp/code-context.sqlite` (no other state exists)
10. **Review receipts periodically**: `pnpm cli receipts` to audit what's been compressed and stored
