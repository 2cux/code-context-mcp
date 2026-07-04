# Example: Agent Using MCP Resources

## Scenario: Agent Session Startup

When an agent connects to CodeContext MCP, it can now discover project context **before** making any tool calls.

---

## Step 1: Agent Lists Available Resources

**Agent sends:**
```json
{
  "method": "resources/list",
  "params": {}
}
```

**CodeContext responds:**
```json
{
  "resources": [
    {
      "uri": "codecontext://project-profile",
      "name": "Project Profile",
      "description": "Current project scope, memory, and context overview",
      "mimeType": "application/json"
    },
    {
      "uri": "codecontext://project-stats",
      "name": "Project Statistics",
      "description": "Token savings, compression, and memory counts",
      "mimeType": "application/json"
    }
  ]
}
```

---

## Step 2: Agent Reads Project Profile

**Agent sends:**
```json
{
  "method": "resources/read",
  "params": {
    "uri": "codecontext://project-profile"
  }
}
```

**CodeContext responds:**
```json
{
  "contents": [
    {
      "uri": "codecontext://project-profile",
      "mimeType": "application/json",
      "text": "{\"scope\":{\"scopeId\":\"D--project-CodeContext\",\"scopeStrategy\":\"git_root\",\"gitRoot\":\"D:/project/CodeContext\",\"branch\":\"main\"},\"memory\":{\"total\":15,\"active\":15,\"byType\":{\"project_rule\":8,\"decision\":4,\"current_task\":3},\"recentSummaries\":[{\"type\":\"project_rule\",\"summary\":\"Use TypeScript strict mode\",\"confidence\":0.95},{\"type\":\"decision\",\"summary\":\"Use Vitest for testing\",\"confidence\":0.9}]},\"compression\":{\"totalCompressed\":42,\"recoverableOriginals\":38,\"tokensSaved\":12450,\"compressionRatio\":0.68},\"staticProfile\":{\"topRules\":[{\"type\":\"project_rule\",\"summary\":\"Use pnpm for package management\",\"confidence\":0.95}]},\"hint\":\"Agent: use recall_context to search project memory, compress_context to save tokens.\"}"
    }
  ]
}
```

---

## Step 3: Agent Makes Informed Decision

**Agent internal reasoning:**

```
Project discovered:
- 15 active memories (8 project rules, 4 decisions, 3 current tasks)
- 42 compressed contexts, 12,450 tokens saved
- Top rule: "Use pnpm for package management"

Decision:
- If user asks about package management → I already know: use pnpm
- If user asks about testing framework → I already know: Vitest
- If user asks about current work → call recall_context with type=current_task
- If user asks about something else → call recall_context with broader query
```

---

## Step 4: Agent Gets Orientation Prompt (Optional)

**Agent sends:**
```json
{
  "method": "prompts/get",
  "params": {
    "name": "project_context_brief"
  }
}
```

**CodeContext responds:**
```json
{
  "description": "Project context brief for agent orientation",
  "messages": [
    {
      "role": "user",
      "content": {
        "type": "text",
        "text": "# CodeContext Project Brief\n\n## Scope\n- Project: `D--project-CodeContext`\n- Strategy: git_root\n- Git root: D:/project/CodeContext\n- Branch: main\n\n## Memory\n- Active memories: 15 / 15 total\n- Recent context:\n  - [project_rule] Use TypeScript strict mode (confidence: 0.95)\n  - [decision] Use Vitest for testing (confidence: 0.90)\n\n## Compression\n- Compressed contexts: 42\n- Token savings: 12,450 tokens saved\n- Average compression: 68.0%\n\n## Project Rules (Static Profile)\n- [project_rule] Use pnpm for package management\n- [project_rule] Use TypeScript strict mode\n\n## Agent Tips\n- Use `recall_context` to search project memory\n- Use `compress_context` to compress long outputs and save tokens\n- Use `remember_context` to save important project facts\n- All context is scoped to this repository\n"
      }
    }
  ]
}
```

**Agent injects this into context window** at session start.

---

## Step 5: User Asks Question

**User:** "What package manager should I use?"

**Agent reasoning:**
```
From project-profile resource:
  staticProfile.topRules[0]: "Use pnpm for package management" (confidence: 0.95)

Decision: Answer directly without calling recall_context.
```

**Agent responds:**
```
Use pnpm for package management. (This is a project rule with 95% confidence from the static profile.)
```

**Result:**
- ✅ Agent answered accurately
- ✅ No `recall_context` tool call needed
- ✅ No receipt created
- ✅ Faster response time

---

## Comparison: With vs Without Resources

### Without Resources (Before)

```
1. User: "What package manager should I use?"
2. Agent: [calls recall_context with query="package manager"]
3. CodeContext: [searches memories, creates receipt]
4. CodeContext: [returns: "Use pnpm" from project_rule memory]
5. Agent: "Use pnpm for package management."

Tool calls: 1
Receipts created: 1
Latency: ~200ms
```

### With Resources (Now)

```
1. Agent: [on session start, reads codecontext://project-profile]
2. CodeContext: [returns cached project context]
3. Agent: [stores context internally]
4. User: "What package manager should I use?"
5. Agent: [checks internal context, finds "Use pnpm" rule]
6. Agent: "Use pnpm for package management."

Tool calls: 0
Receipts created: 0
Latency: ~0ms (already in memory)
```

---

## When to Still Use Tools

Agents should **still call tools** when:
- Searching for specific memory content not in top 5
- Adding new project memory (`remember_context`)
- Compressing long outputs (`compress_context`)
- Getting full memory details (`recall_context` with filters)
- Forgetting outdated memory (`forget_context`)

**Resources are for orientation, tools are for mutation and deep search.**

---

## Summary

**Before:** Agent starts blind, must call `recall_context` to discover project state.  
**After:** Agent reads `project-profile` resource, knows project rules and recent context instantly.

**Win:** Faster orientation, fewer tool calls, no unnecessary receipts.
