# Post-RC Feedback Loop

> **Status**: RC feedback mechanism — no code changes in this document.
> **Current RC**: v1.0.0-rc (package.json) / v0.3.0-rc (release checklist)

## 1. Feedback Collection

### Channels

- GitHub Issues on `2cux/code-context-mcp` with RC-specific labels
- Direct feedback via MCP client logs (Claude Code, Cursor, OpenCode, Codex CLI)
- Harness run receipts (`runs/` directory) for reproducible bug reports

### Feedback Template

```markdown
## RC Feedback

- **Environment**: [Node.js version, OS, RAM]
- **MCP client**: [Claude Code / Cursor / OpenCode / Codex CLI / Other]
- **MCP_TOOL_MODE**: [agent / dev / test]
- **Task attempted**: [Brief description of what the agent was asked to do]
- **Tools called**: [List of MCP tools the agent used]
- **Expected behavior**: [What should have happened]
- **Actual behavior**: [What actually happened]
- **Logs or runId**: [Relevant log excerpts or harness run IDs]
- **Severity**: [critical / major / minor / cosmetic]
```

### Log Collection Guide

| Client | Log Location | Notes |
|---|---|---|
| Claude Code | `~/.claude/logs/` | MCP tool calls logged with timestamps |
| Cursor | Output panel → MCP | MCP server stderr visible |
| OpenCode | `~/.opencode/logs/` | Check MCP transport logs |
| Codex CLI | Terminal output | MCP connect/disconnect visible |

## 2. Issue Labels

| Label | Description | Example Triggers |
|---|---|---|
| `agent-selection` | Agent chose wrong tool or called hidden tool | Agent tried `list_context` in agent mode |
| `performance` | Slow compression, high memory, cache misses | Cold cache >200ms, OOM on 8GB |
| `tool-mode` | MCP_TOOL_MODE not working as documented | Dev mode only shows 7 tools |
| `memory-recall` | Recall returned wrong/irrelevant memories | FTS missing relevant context |
| `compression-quality` | Compression lost critical info | Stack traces truncated, paths missing |
| `docs` | Documentation errors, missing config | README config doesn't work |
| `build-install` | npm install, build, or CLI issues | tsc errors after clean clone |
| `rc-process` | Feedback about the RC process itself | Missing test data, unclear prompts |

### Label Usage Rules

1. Every RC feedback issue must have at least one RC label.
2. Issues without reproduction steps get `needs-repro`.
3. Issues confirmed as RC-blockers get `rc-blocker` in addition to the category label.
4. Issues fixed during RC hardening get `rc-fixed`. Issues deferred to stable get `stable-backlog`.

## 3. Triage Flow

```
Feedback Received
    ↓
Reproduce? ──No──→ ask for logs / runId
    ↓ Yes
Categorize (apply label)
    ↓
Severity Assessment
    ├── critical → rc-blocker → fix before stable
    ├── major    → rc-fixed or stable-backlog
    ├── minor    → stable-backlog (unless quick fix)
    └── cosmetic → stable-backlog
```

## 4. Stable Gating Criteria

### MUST (all required before stable release)

| Gate | Criteria | Current Status |
|---|---|---|
| G1 — Type Safety | `tsc --noEmit` zero errors | ✅ Pass |
| G2 — Test Suite | `vitest run` zero failures (non-perf) | ✅ 1285 tests, 0 failures |
| G3 — Standard Perf | `PERF_TEST=1` all standard tests pass | ✅ Pass |
| G4 — Agent Mode | 7 tools, no dangerous tools exposed | ✅ Verified |
| G5 — Tool Security | ListTools + CallTool enforcement passes | ✅ 60 regression tests |
| G6 — Clean Install | `clean-install-smoke.mjs` 9/9 passes | ✅ Pass |
| G7 — Package Integrity | `npm pack --dry-run` excludes local data | ✅ Pass |
| G8 — Docs Sync | README, CHANGELOG, release notes consistent | ✅ Pass |
| G9 — Zero RC-Blockers | No open issues labeled `rc-blocker` | ⬜ Pending external feedback |
| G10 — Agent Validation | At least one real agent client validated | ⬜ Pending real agent testing |

### SHOULD (recommended, not blocking)

| Gate | Criteria |
|---|---|
| S1 — Extreme Perf | `PERF_TEST_EXTREME=1` runs on 16GB+ machine |
| S2 — Multi-Client | Validated on ≥2 different MCP clients |
| S3 — Cross-Platform | Validated on macOS, Windows, Linux |
| S4 — Upgrade Path | Existing v0.2.0-beta users can upgrade without data loss |

### Decision Matrix

| G1–G8 | G9 | G10 | Decision |
|---|---|---|---|
| All ✅ | ✅ | ✅ | → **Stable** |
| All ✅ | ❌ (known minor) | ✅ | → **Stable** with known issues |
| All ✅ | ❌ (critical) | — | → **RC2** (fix and re-evaluate) |
| Any ❌ | — | — | → **RC2** (fix failures) |

## 5. Post-RC Feedback Loop Process

### Phase 1: Collect (1–2 weeks after RC)

- Open GitHub issue template with RC labels
- Monitor MCP client communities for CodeContext mentions
- Record all feedback in `reports/rc-feedback/` with run IDs

### Phase 2: Triage (ongoing during Phase 1)

- Categorize each issue with labels
- Reproduce with test fixtures when possible
- Mark `rc-blocker` for anything that prevents stable release
- Write regression test for each confirmed bug

### Phase 3: Fix & Verify

- Fix rc-blockers first
- Rerun full test suite after each fix (`tsc` + `vitest run` + `PERF_TEST=1`)
- Update `CHANGELOG.md` with RC fixes
- Document workarounds for deferred issues

### Phase 4: Stable Decision

- Review gating matrix (Section 4)
- If G1–G10 all pass: tag stable, update version, publish
- If not: identify gaps, plan RC2 scope, repeat

## 6. RC Issue Template (for GitHub)

```yaml
name: RC Feedback
description: Report an issue found during RC testing
labels: [rc-feedback]
body:
  - type: dropdown
    id: mode
    attributes:
      label: MCP_TOOL_MODE
      options: [agent, dev, test]
  - type: dropdown
    id: client
    attributes:
      label: MCP Client
      options: [Claude Code, Cursor, OpenCode, Codex CLI, Other]
  - type: textarea
    id: task
    attributes:
      label: Task Attempted
  - type: textarea
    id: expected
    attributes:
      label: Expected Behavior
  - type: textarea
    id: actual
    attributes:
      label: Actual Behavior
  - type: textarea
    id: logs
    attributes:
      label: Logs or Run ID
  - type: dropdown
    id: severity
    attributes:
      label: Severity
      options: [critical, major, minor, cosmetic]
```

## 7. RC Feedback Archive

All RC feedback should be archived under `reports/rc-feedback/`:

```
reports/rc-feedback/
├── README.md                  # Summary of all feedback
├── template.md                # Copy of the feedback template
├── issue-001-<slug>.md        # Individual feedback reports
└── triage-log.md              # Triage decisions and rationale
```

## 8. Feedback → Action Mapping

| Feedback Signal | Action |
|---|---|
| Agent calls hidden tool in agent mode | Verify tool mode security regression; if confirmed → rc-blocker |
| Compression loses stack trace | Check strategy; add test case → `compression-quality` fix |
| Recall returns irrelevant memories | Adjust FTS scoring or add test → `memory-recall` fix |
| OOM on 8GB with standard perftest | Check memory guard; if failing → rc-blocker |
| README config doesn't work | Fix config example → `docs` fix |
| Build fails after clean clone | Check package.json `files` and `.gitignore` → `build-install` fix |
