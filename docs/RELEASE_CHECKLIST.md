# Release Checklist

> Archived: 2026-06-14
> Historical checklist for the CodeContext MCP v1.0.0 stable release

---

## Pre-Release Verification

### Build & TypeScript

- [x] `npx tsc --noEmit` — zero errors
- [x] No `// @ts-ignore` or `any` casts without explicit justification
- [x] `package.json` version is correct

### Test Suite

- [x] `npx vitest run` — discovered test suite has zero failures
- [x] `PERF_TEST=1 npx vitest run tests/performance/` — standard performance tests pass
- [x] `PERF_TEST=1 PERF_TEST_EXTREME=1` — extreme perf documented (needs >16GB RAM)

### MCP Tool Surface

- [x] 18 MCP tools registered via shared `toolRegistry.ts`
- [x] `run_context_flow` available as unified agent entry point
- [x] Default agent mode: 7 tools (safe, usability-evaluated 95% score)
- [x] Dangerous tools (`delete_original`, `cleanup_originals`) hidden in agent mode
- [x] Harness tools (4) hidden in agent mode
- [x] `MCP_TOOL_MODE` env var works (agent/dev/test)

### Harness

- [x] 7 Harness flows registered and tested
- [x] Real `createMcpAdapter()` supports all 18 tools via shared registry
- [x] `mcpToolsSmokeFlow` exercises all 14 production tools with real adapter
- [x] Mock adapter preserved for testing

### Performance

- [x] Performance baseline report exists: `reports/performance/`
- [x] Standard latency targets verified (100KB compression <100ms, recall <10ms)
- [x] Cache hit latency verified (~2ms for 100KB)

### Documentation

- [x] `MCP_TOOLS.md` — all 18 tools documented
- [x] `README.md` — updated tool count (18), new doc links
- [x] `docs/TOOL_SURFACE.md` — mode configuration documented
- [x] `docs/TOOL_INVENTORY.md` — full inventory with risk/decision matrix
- [x] `docs/TOOL_SURFACE_DECISION_MATRIX.md` — Surface/Hide/Merge decisions
- [x] `docs/MCP_USABILITY_TEST_PLAN.md` — usability test plan
- [x] `reports/usability/agent-usability-report.md` — 3-mode comparison (95% agent score)
- [x] `reports/tool-surface/tool-prune-recommendation.md` — per-tool decisions

### No Stale References

- [x] No "13 MCP tools" or "17 MCP tools" in docs
- [x] No "mcpAdapter only supports 4 tools" references
- [x] No "createMcpAdapter stub" references
- [x] All docs reference current architecture (toolRegistry.ts, 18 tools)

---

## Known Limitations

- Extreme perf tests (500KB+) need >16GB RAM due to Node.js module baseline overhead
- Usability evaluation is static analysis — manual Agent testing not yet performed
- No image/binary compression support (explicitly out of scope)
- No cloud sync (explicitly out of scope)

---

## Verification Command

```bash
# Traceable clean release gate (requires a clean git working tree)
pnpm release:gate
```

The gate captures the current commit, builds and runs all checks in a detached
temporary worktree, creates one final npm tgz, and uses that exact tgz for the
fresh-install MCP functional smoke. Its JSON/Markdown reports record the git
dirty state before and after the run, commit, tgz SHA-256, package file count,
and generation time. The command prints the temporary output directory; it
does not write generated reports or artifacts into the caller working tree.

A PASS is valid only when the stable gate and fresh-install smoke refer to the
same commit and tgz, and the caller working tree remains clean and on the same
commit after the run. The gate never creates a tag and never runs `npm publish`.
