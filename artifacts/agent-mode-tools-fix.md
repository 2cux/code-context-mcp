# Agent Mode Tools Fix

## Problem

Project context resources and prompts were showing `list_context` and missing other agent-mode tools, causing confusion for agents about which tools are actually available in agent mode.

## Solution

Updated `resourceHandlers.ts` and `promptHandlers.ts` to show exactly the 7 agent-mode tools:

1. `current_scope` - show current repository scope
2. `compress_context` - compress long content and save tokens
3. `retrieve_original` - expand compressed context
4. `remember_context` - save important project facts
5. `recall_context` - search project memory by query
6. `forget_context` - remove outdated memories
7. `run_context_flow` - unified compression + memory flow

## Dev-Only Tools (Excluded from Agent Mode)

These tools are never shown in agent-mode resources/prompts:

- `list_context` - dev/test only
- `list_compressions` - dev/test only
- `analyze_context` - dev/test only
- `list_failures` - dev/test only
- `failure_stats` - dev/test only
- `list_harness_flows` - dev/test only
- `run_harness_flow` - dev/test only
- `get_harness_run` - dev/test only
- `check_harness_flow` - dev/test only
- `delete_original` - dangerous, dev/test only
- `cleanup_originals` - dangerous, dev/test only

## Changes

### src/mcp/resourceHandlers.ts

**Before:**
```typescript
availableTools: [
  "recall_context - search project memory by query",
  "compress_context - compress long content and save tokens",
  "remember_context - save important project facts",
  "list_context - list all memories",  // ❌ dev-only tool
  "forget_context - remove outdated memories",
]
```

**After:**
```typescript
availableTools: [
  "current_scope - show current repository scope",
  "compress_context - compress long content and save tokens",
  "retrieve_original - expand compressed context",
  "remember_context - save important project facts",
  "recall_context - search project memory by query",
  "forget_context - remove outdated memories",
  "run_context_flow - unified compression + memory flow",
]
```

### src/mcp/promptHandlers.ts

**Before:**
```markdown
## Available Tools
- `recall_context(query)` — search project memory
- `compress_context(content, type)` — compress long content
- `remember_context(type, content, summary)` — save project facts
- `list_context(status?, type?)` — list all memories  ❌ dev-only
- `forget_context(memoryId)` — remove outdated memory
```

**After:**
```markdown
## Available Tools
- `current_scope()` — show current repository scope
- `compress_context(content, type)` — compress long content
- `retrieve_original(ccrId)` — expand compressed context
- `remember_context(type, content, summary)` — save project facts
- `recall_context(query)` — search project memory
- `forget_context(memoryId)` — remove outdated memory
- `run_context_flow(flowType, payload)` — unified compression + memory flow
```

## Tests Added

### tests/mcp/promptHandlers.test.ts

New test: `should only show agent-mode tools in project_context_brief (7 tools)`
- Verifies all 7 agent-mode tools are present
- Verifies all 11 dev-only tools are NOT present
- Counts tool lines to ensure exactly 7 tools

### tests/mcp/resourceHandlers.test.ts

New test: `should only show agent-mode tools in project-profile (7 tools)`
- Verifies exactly 7 tools in `availableTools` array
- Verifies all 7 agent-mode tools are present
- Verifies all 11 dev-only tools are NOT present

## Verification

All tests pass:
```bash
npx tsc --noEmit  # ✓ Type check passed
npx vitest run tests/mcp/resourceHandlers.test.ts  # ✓ 6 tests passed
npx vitest run tests/mcp/promptHandlers.test.ts  # ✓ 5 tests passed
npx vitest run tests/mcp/serverIntegration.test.ts  # ✓ 6 tests passed
```

## Impact

- Agents now see accurate tool surface in project context
- No confusion about which tools are available
- Tests prevent regression
- No new MCP tools added
- Agent mode remains 7 tools as designed
