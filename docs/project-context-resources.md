# Project Context Resources & Prompts

## Overview

CodeContext MCP provides project context through **MCP resources** and **prompts**, inspired by Supermemory's profile/resource approach.

Agents can access project context without understanding internal storage details.

---

## Resources

### `codecontext://project-profile`

**Purpose**: User-readable project context snapshot

**Format**: JSON

**Structure**:

```json
{
  "projectIdentity": {
    "scopeId": "codecontext-mcp",
    "scopeStrategy": "git-repo",
    "gitRoot": "/path/to/repo",
    "remote": "https://github.com/user/repo.git",
    "branch": "main",
    "note": "Local-first storage. No project code, logs, or memory uploaded."
  },
  "stableProjectRules": [
    {
      "type": "project_rule",
      "summary": "Use TypeScript strict mode",
      "confidence": 0.95,
      "createdAt": "2026-07-04T10:00:00.000Z"
    }
  ],
  "recentActivity": [
    {
      "type": "decision",
      "summary": "Switched to Vitest for testing",
      "confidence": 0.9,
      "createdAt": "2026-07-04T11:30:00.000Z"
    }
  ],
  "importantMemories": [
    {
      "type": "architecture",
      "summary": "MCP server with dual capabilities: compression + memory",
      "confidence": 0.92,
      "createdAt": "2026-07-04T09:00:00.000Z"
    }
  ],
  "memoryOverview": {
    "total": 15,
    "active": 12,
    "byType": {
      "project_rule": 3,
      "decision": 4,
      "architecture": 2,
      "lesson": 3
    }
  },
  "compressionOverview": {
    "totalCompressed": 8,
    "recoverableOriginals": 6,
    "tokensSaved": 45000,
    "compressionRatio": 0.68
  },
  "lastUpdated": "2026-07-04T12:00:00.000Z",
  "agentGuidance": {
    "availableTools": [
      "recall_context - search project memory by query",
      "compress_context - compress long content and save tokens",
      "remember_context - save important project facts",
      "list_context - list all memories",
      "forget_context - remove outdated memories"
    ],
    "localFirstNote": "All context is scoped to this repository. Do not upload project code or logs."
  }
}
```

**Key Features**:

- **Project identity**: Clear scope + local-first note
- **Stable rules**: Top 5 static profile facts (project conventions)
- **Recent activity**: Last 3 dynamic events
- **Important memories**: Top 5 memories by confidence
- **Agent guidance**: Available tools + constraints

---

### `codecontext://project-stats`

**Purpose**: Token savings, compression, and memory counts

**Format**: JSON

**Structure**:

```json
{
  "scopeId": "codecontext-mcp",
  "compressionCount": 8,
  "memoryCount": 12,
  "recoverableOriginalsCount": 6,
  "totalEstimatedTokensSaved": 45000,
  "lastUpdated": "2026-07-04T12:00:00.000Z",
  "detailedStats": {
    "memory": {
      "total": 15,
      "active": 12,
      "superseded": 2,
      "forgotten": 1,
      "expired": 0
    },
    "compression": {
      "totalCCRs": 8,
      "recoverableOriginals": 6,
      "averageCompressionRatio": 0.68
    },
    "tokens": {
      "totalCompressions": 8,
      "totalRetrieves": 3,
      "totalMemories": 15,
      "totalRecalls": 42,
      "totalTokensBefore": 130000,
      "totalTokensAfter": 85000,
      "totalTokensSaved": 45000
    }
  }
}
```

**Key Features**:

- **Summary counts**: Top-level metrics for quick reference
- **Detailed breakdown**: Full memory lifecycle + token stats
- **Last updated**: Timestamp of latest activity

---

## Prompts

### `project_context_brief`

**Purpose**: Agent-injectable short context (~800 tokens)

**Format**: Markdown text message

**Output Example**:

```markdown
# CodeContext Project Brief

## Current Project
Project: `codecontext-mcp`
Branch: main

**Local-first constraint**: Do not upload project code, logs, or memory content.

## Project Rules
- [project_rule] Use TypeScript strict mode
- [project_rule] Use Vitest for testing
- [architecture] MCP server with dual capabilities: compression + memory

## Recent Memory
- [decision] Switched to Vitest for testing
- [lesson] Compression must fail-open to avoid blocking agents
- [architecture] Store original content separately from compressed

## Stats
- Active memories: 12
- Compressed contexts: 8
- Token savings: 45,000

## Available Tools
- `recall_context(query)` — search project memory
- `compress_context(content, type)` — compress long content
- `remember_context(type, content, summary)` — save project facts
- `list_context(status?, type?)` — list all memories
- `forget_context(memoryId)` — remove outdated memory

All operations are scoped to this repository.
```

**Key Features**:

- **Concise**: Targets ~800 tokens max
- **Current rules**: Top 3 project rules shown
- **Recent context**: 3 most relevant memories
- **Tool guidance**: Clear API signatures
- **Constraints**: Local-first reminder

---

## Design Principles

1. **No internal exposure**: Agents don't see scope/storage/hash details
2. **User-readable**: Resources return human-friendly JSON
3. **Agent-ready**: Prompts inject directly into agent context
4. **Local-first**: Every output reminds about upload constraints
5. **No HarnessRunner**: Resources/prompts bypass tool routing

---

## Usage

### From Agent Code

```typescript
// List available resources
const resources = await mcp.listResources();

// Read project profile
const profile = await mcp.readResource("codecontext://project-profile");

// Get context brief prompt
const brief = await mcp.getPrompt("project_context_brief");
```

### From MCP Client (e.g., Claude Desktop)

Resources appear in the MCP resource browser:
- `codecontext://project-profile` → JSON view
- `codecontext://project-stats` → Stats dashboard

Prompts appear in the prompt library:
- `project_context_brief` → Inject context

---

## Testing

```bash
# Type check
npx tsc --noEmit

# Run tests
npx vitest run tests/mcp/resourceHandlers.test.ts
npx vitest run tests/mcp/promptHandlers.test.ts
```

**Test Coverage**:

- ✅ Resource discovery (listResources)
- ✅ Prompt discovery (listPrompts)
- ✅ Empty project output
- ✅ Project with demo data output
- ✅ Resource/prompt bypass HarnessRunner
- ✅ Enhanced structure validation

---

## Future Enhancements

Potential additions (not in scope for first version):

- `codecontext://recent-compressions` — last 10 compressed contexts
- `codecontext://memory-timeline` — chronological memory view
- `project_context_detailed` prompt — full context (5000 tokens)
- `compression_recommendations` prompt — suggest what to compress

---

## Comparison: Before vs. After

### Before

**project-profile**:
```json
{
  "scope": { "scopeId": "..." },
  "memory": { "total": 15, "recentSummaries": [...] },
  "hint": "Agent: use recall_context..."
}
```

### After

**project-profile**:
```json
{
  "projectIdentity": {
    "scopeId": "...",
    "note": "Local-first storage. No code uploaded."
  },
  "stableProjectRules": [...],
  "recentActivity": [...],
  "importantMemories": [...],
  "agentGuidance": {
    "availableTools": [...],
    "localFirstNote": "..."
  }
}
```

**Key Improvements**:

1. **Structured guidance**: `agentGuidance` replaces generic hint
2. **Rule separation**: `stableProjectRules` vs. `recentActivity`
3. **Local-first clarity**: Explicit note in identity
4. **Tool list**: Full tool signatures with descriptions
5. **Activity tracking**: Recent dynamic facts highlighted
