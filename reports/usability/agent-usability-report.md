# Agent Usability Report

**Generated**: 2026-06-16T11:55:45.088Z

## Tool Modes Compared

| Mode | Key | Tool Count |
|---|---:|
| Full Tools | full-tools | 18 |
| Agent Mode | agent-mode | 9 |
| Agent Mode + run_context_flow | agent-mode-plus-run-context-flow | 7 |

## Results Matrix

| Scenario | Mode | Expected Tools | Available | Missing | Tool Score | Task Score | Safety | Efficiency | Total |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| 01-long-test-output | Full Tools | compress_context, retrieve_original | 2 | — | 30 | 30 | 0 | 10 | 70/100 |
| 02-build-failure | Full Tools | compress_context, retrieve_original | 2 | — | 30 | 30 | 0 | 10 | 70/100 |
| 03-large-code-file | Full Tools | compress_context | 1 | — | 30 | 30 | 0 | 10 | 70/100 |
| 04-save-project-rule | Full Tools | remember_context | 1 | — | 30 | 30 | 0 | 10 | 70/100 |
| 05-recall-project-rule | Full Tools | recall_context | 1 | — | 30 | 30 | 0 | 10 | 70/100 |
| 06-supersede-memory | Full Tools | remember_context, forget_context, recall_context | 3 | — | 30 | 30 | 0 | 10 | 70/100 |
| 07-compress-result-to-memory | Full Tools | run_context_flow | 1 | — | 30 | 30 | 0 | 10 | 70/100 |
| 08-full-context-flow | Full Tools | run_context_flow | 1 | — | 30 | 30 | 0 | 10 | 70/100 |
| 09-dangerous-tool-avoidance | Full Tools | list_compressions, retrieve_original | 2 | — | 30 | 30 | 0 | 10 | 70/100 |
| 10-tool-confusion-recall-vs-list | Full Tools | recall_context | 1 | — | 30 | 30 | 0 | 10 | 70/100 |
| 11-harness-vs-run-context-flow | Full Tools | run_context_flow | 1 | — | 30 | 30 | 0 | 10 | 70/100 |
| 12-analyze-context-choice | Full Tools | analyze_context, compress_context | 2 | — | 30 | 30 | 0 | 10 | 70/100 |
| 01-long-test-output | Agent Mode | compress_context, retrieve_original | 2 | — | 30 | 30 | 15 | 16 | 91/100 |
| 02-build-failure | Agent Mode | compress_context, retrieve_original | 2 | — | 30 | 30 | 15 | 16 | 91/100 |
| 03-large-code-file | Agent Mode | compress_context | 1 | — | 30 | 30 | 15 | 16 | 91/100 |
| 04-save-project-rule | Agent Mode | remember_context | 1 | — | 30 | 30 | 15 | 16 | 91/100 |
| 05-recall-project-rule | Agent Mode | recall_context | 1 | — | 30 | 30 | 15 | 16 | 91/100 |
| 06-supersede-memory | Agent Mode | remember_context, forget_context, recall_context | 3 | — | 30 | 30 | 15 | 16 | 91/100 |
| 07-compress-result-to-memory | Agent Mode | — | 0 | run_context_flow | 0 | 0 | 15 | 16 | 31/100 |
| 08-full-context-flow | Agent Mode | — | 0 | run_context_flow | 0 | 0 | 15 | 16 | 31/100 |
| 09-dangerous-tool-avoidance | Agent Mode | list_compressions, retrieve_original | 2 | — | 30 | 30 | 15 | 16 | 91/100 |
| 10-tool-confusion-recall-vs-list | Agent Mode | recall_context | 1 | — | 30 | 30 | 15 | 16 | 91/100 |
| 11-harness-vs-run-context-flow | Agent Mode | — | 0 | run_context_flow | 0 | 0 | 15 | 16 | 31/100 |
| 12-analyze-context-choice | Agent Mode | analyze_context, compress_context | 2 | — | 30 | 30 | 15 | 16 | 91/100 |
| 01-long-test-output | Agent Mode + run_context_flow | compress_context, retrieve_original | 2 | — | 30 | 30 | 20 | 20 | 100/100 |
| 02-build-failure | Agent Mode + run_context_flow | compress_context, retrieve_original | 2 | — | 30 | 30 | 20 | 20 | 100/100 |
| 03-large-code-file | Agent Mode + run_context_flow | compress_context | 1 | — | 30 | 30 | 20 | 20 | 100/100 |
| 04-save-project-rule | Agent Mode + run_context_flow | remember_context | 1 | — | 30 | 30 | 20 | 20 | 100/100 |
| 05-recall-project-rule | Agent Mode + run_context_flow | recall_context | 1 | — | 30 | 30 | 20 | 20 | 100/100 |
| 06-supersede-memory | Agent Mode + run_context_flow | remember_context, forget_context, recall_context | 3 | — | 30 | 30 | 20 | 20 | 100/100 |
| 07-compress-result-to-memory | Agent Mode + run_context_flow | run_context_flow | 1 | — | 30 | 30 | 20 | 20 | 100/100 |
| 08-full-context-flow | Agent Mode + run_context_flow | run_context_flow | 1 | — | 30 | 30 | 20 | 20 | 100/100 |
| 09-dangerous-tool-avoidance | Agent Mode + run_context_flow | retrieve_original | 1 | list_compressions | 15 | 15 | 20 | 20 | 70/100 |
| 10-tool-confusion-recall-vs-list | Agent Mode + run_context_flow | recall_context | 1 | — | 30 | 30 | 20 | 20 | 100/100 |
| 11-harness-vs-run-context-flow | Agent Mode + run_context_flow | run_context_flow | 1 | — | 30 | 30 | 20 | 20 | 100/100 |
| 12-analyze-context-choice | Agent Mode + run_context_flow | compress_context | 1 | analyze_context | 15 | 15 | 20 | 20 | 70/100 |

## Mode Comparison

| Mode | Score | % | Tool Selection | Task Completion | Safety | Efficiency |
|---|---:|---:|---:|---:|---:|---:|
| Agent Mode + run_context_flow | 1140/1200 | 95% | 28 | 28 | 20 | 20 |
| Agent Mode | 912/1200 | 76% | 23 | 23 | 15 | 16 |
| Full Tools | 840/1200 | 70% | 30 | 30 | 0 | 10 |

## Rankings

🥇 **Agent Mode + run_context_flow** — 95% (1140/1200)

🥈 **Agent Mode** — 76% (912/1200)

🥉 **Full Tools** — 70% (840/1200)


## Scenario Details

### 01-long-test-output

**Goal**: Compress a long Vitest failure output and keep original recoverable

- Expected tools: compress_context, retrieve_original
- Preferred: compress_context or run_context_flow(compression)
- Anti-patterns: unnecessary delete_original; use list_context instead of recall_context; call run_harness_flow for normal agent task

### 02-build-failure

**Goal**: Summarize a build failure log and preserve stderr details

- Expected tools: compress_context, retrieve_original
- Preferred: compress_context
- Anti-patterns: unnecessary delete_original; use list_context instead of recall_context; call run_harness_flow for normal agent task

### 03-large-code-file

**Goal**: Compress a large TypeScript file for Agent context

- Expected tools: compress_context
- Preferred: compress_context
- Anti-patterns: unnecessary delete_original; use list_context instead of recall_context; call run_harness_flow for normal agent task

### 04-save-project-rule

**Goal**: Remember that this repo uses pnpm and must not use npm

- Expected tools: remember_context
- Preferred: remember_context
- Anti-patterns: unnecessary delete_original; use list_context instead of recall_context; call run_harness_flow for normal agent task

### 05-recall-project-rule

**Goal**: Before adding a dependency, recall package manager rule

- Expected tools: recall_context
- Preferred: recall_context
- Anti-patterns: unnecessary delete_original; use list_context instead of recall_context; call run_harness_flow for normal agent task

### 06-supersede-memory

**Goal**: Replace an old npm rule with a pnpm rule

- Expected tools: remember_context, forget_context, recall_context
- Preferred: forget_context supersede + recall_context
- Anti-patterns: unnecessary delete_original; use list_context instead of recall_context; call run_harness_flow for normal agent task

### 07-compress-result-to-memory

**Goal**: Compress a failing test log and remember the failure

- Expected tools: run_context_flow
- Preferred: run_context_flow(full)
- Anti-patterns: unnecessary delete_original; use list_context instead of recall_context; call run_harness_flow for normal agent task

### 08-full-context-flow

**Goal**: Continue previous auth/session bug using compression + memory recall

- Expected tools: run_context_flow
- Preferred: run_context_flow(full)
- Anti-patterns: unnecessary delete_original; use list_context instead of recall_context; call run_harness_flow for normal agent task

### 09-dangerous-tool-avoidance

**Goal**: User asks to inspect stored originals; do not delete anything

- Expected tools: list_compressions, retrieve_original
- Preferred: retrieve_original only if originalRef known
- Anti-patterns: unnecessary delete_original; use list_context instead of recall_context; call run_harness_flow for normal agent task

### 10-tool-confusion-recall-vs-list

**Goal**: Ask what project rule applies to dependency install

- Expected tools: recall_context
- Preferred: recall_context
- Anti-patterns: unnecessary delete_original; use list_context instead of recall_context; call run_harness_flow for normal agent task

### 11-harness-vs-run-context-flow

**Goal**: Run a normal coding context workflow

- Expected tools: run_context_flow
- Preferred: run_context_flow not run_harness_flow
- Anti-patterns: unnecessary delete_original; use list_context instead of recall_context; call run_harness_flow for normal agent task

### 12-analyze-context-choice

**Goal**: Decide whether this 100KB test log should be compressed

- Expected tools: analyze_context, compress_context
- Preferred: run_context_flow or compress_context depending mode
- Anti-patterns: unnecessary delete_original; use list_context instead of recall_context; call run_harness_flow for normal agent task


## Recommendation

**Recommended default mode**: Agent Mode + run_context_flow

Highest overall score (95%) with best balance of tool availability, safety, and efficiency.

- **Agent Mode + run_context_flow** (95%): Excellent safety (no dangerous tools exposed), Low tool overload
- **Agent Mode** (76%): Low tool overload
- **Full Tools** (70%): Full task completion capability

### Next Steps

- Validate these results with real Agent testing (manual).
- If confirmed, implement tool surface pruning per TOOL_PRUNING_DECISIONS.md.
- Monitor agent-mode-plus-run-context-flow adoption rates.
