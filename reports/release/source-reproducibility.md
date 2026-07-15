# Source Reproducibility

**Generated**: 2026-07-15T07:21:33.640Z
**Verdict**: **PASS**

## Failure diagnosis

- **Resolved file**: `examples/first-run/sample-error.log`
- **Failed command**: `npx vitest run`
- **Root cause**: The demo-required sample existed locally but was absent from git ls-files, so clean tracked-source tests could not run the demo flow.

## Clean-source constraints

- Source directory built from git ls-files: 429 files
- Required tracked-file check: PASS
- Isolated pnpm store/cache/HOME/database: PASS

## Commands

| Command | Status | Exit | Duration |
|---|---|---:|---:|
| `git init -q` | PASS | 0 | 234ms |
| `git checkout -q -b main` | PASS | 0 | 130ms |
| `git remote add origin https://github.com/2cux/code-context-mcp` | PASS | 0 | 168ms |
| `git commit --allow-empty -m reproducibility metadata` | PASS | 0 | 334ms |
| `cmd /d /s /c pnpm install --frozen-lockfile` | PASS | 0 | 17471ms |
| `cmd /d /s /c pnpm build` | PASS | 0 | 4756ms |
| `cmd /d /s /c npx vitest run` | PASS | 0 | 184724ms |

## Required source inventory

- Missing tracked files: none
- Untracked required files: none
