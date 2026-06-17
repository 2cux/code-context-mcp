# Tool Surface Prune Recommendation

> Based on: `reports/usability/agent-usability-report.json`, `docs/TOOL_INVENTORY.md`
>
> Generated: 2026-06-16

---

## Decision Matrix

| Tool | Current Role | Observed Usage | Agent Risk | Decision | Reason |
|---|---|---|---:|---|------|
| `current_scope` | scope resolver | Every flow starts here | — | **keep-agent** | Essential — all other tools depend on scopeId |
| `compress_context` | compression | 83% of scenarios (5/6 compression scenarios) | — | **keep-agent** | Core capability #1 |
| `retrieve_original` | original retrieval | Required with compression | — | **keep-agent** | Compression recovery pair |
| `remember_context` | memory write | Memory scenarios need it | — | **keep-agent** | Core capability #2 |
| `recall_context` | memory search | 50%+ scenarios need recall | — | **keep-agent** | Memory retrieval pair |
| `forget_context` | memory lifecycle | Supersede/expire needed | hard_delete risk | **keep-agent** | Lifecycle management (soft modes safe) |
| `run_context_flow` | unified entry | 83% of scenarios could use it | — | **keep-agent** | Highest efficiency score |
| `list_context` | memory audit | Dev debugging, not agent task | — | **dev-only** | Agent uses recall, not list |
| `list_compressions` | compression audit | Dev inspection only | — | **dev-only** | Agent uses compress_context+retrieve |
| `analyze_context` | decision support | Low usage; run_context_flow covers | — | **dev-only** | Integrated into run_context_flow's recall step |
| `list_failures` | failure audit | Internal ops only | — | **dev-only** | Not for agent tasks |
| `failure_stats` | failure aggregation | Internal ops only | — | **dev-only** | Not for agent tasks |
| `list_harness_flows` | flow discovery | Harness dev tool | — | **dev-only** | Dev/CI only |
| `run_harness_flow` | flow execution | Has side effects | — | **dev-only** | Dev/CI only |
| `get_harness_run` | run inspection | Harness dev tool | — | **dev-only** | Dev/CI only |
| `check_harness_flow` | manifest validation | Harness dev tool | — | **dev-only** | Dev/CI only |
| `delete_original` | delete original | Irreversible | HIGH | **test-only** | Dangerous — CLI alternative exists |
| `cleanup_originals` | batch cleanup | Irreversible batch | HIGH | **test-only** | Dangerous — CLI alternative exists |

---

## Summary

| Category | Count | Tools |
|----------|-------|-------|
| **keep-agent** | 7 | current_scope, compress_context, retrieve_original, remember_context, recall_context, forget_context, run_context_flow |
| **dev-only** | 9 | list_context, list_compressions, analyze_context, list_failures, failure_stats, list_harness_flows, run_harness_flow, get_harness_run, check_harness_flow |
| **test-only** | 2 | delete_original, cleanup_originals |

**No tools deleted.** All 18 tools remain available in test mode. Agent mode exposes 7 safe tools. Dev mode adds inspection tools without exposing destructive operations.

## Risks

| Risk | Mitigation |
|------|-----------|
| Agent cannot access `list_context` to find memory IDs for `forget_context` | Agent can use `recall_context` (search) or `run_context_flow` (memory mode) instead |
| Devs need `delete_original` for maintenance | Available via `MCP_TOOL_MODE=test` or CLI: `code-context cleanup` |
| `analyze_context` valuable for agent decision-making | Integrated into `run_context_flow`'s internal pipeline; direct access available in dev mode |

## Rollback

To restore full 18-tool surface: `MCP_TOOL_MODE=test`
To restore dev surface (17 tools): `MCP_TOOL_MODE=dev`
Default (agent, 7 tools): no env var needed.
