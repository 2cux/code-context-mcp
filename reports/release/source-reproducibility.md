# Source Reproducibility

**Generated**: 2026-07-15T06:54:34.966Z
**Verdict**: **FAIL**

## Failure diagnosis

- **File**: `vitest.config.ts / failing test output`
- **Command**: `cmd /d /s /c npx vitest run`
- **Reason**: npm warn Unknown env config "store-dir". This will stop working in the next major version of npm.
X [ERROR] Cannot read directory "../../../..": Access is denied.

X [ERROR] Could not resolve "C:\\Users\\Lenovo\\AppData\\Local\\Temp\\CodeContext-source-repro-1784098476207\\vitest.config.ts"

[31mfailed to load config from C:\Users\Lenovo\AppData\Local\Temp\CodeContext-source-repro-1784098476207\vitest.config.ts[39m

[31m⎯⎯⎯⎯⎯⎯⎯[1m[7m Startup Error [27m[22m⎯⎯⎯⎯⎯⎯⎯⎯[39m
Error: Build failed with 2 errors:
error: Cannot read directory "../../../..": Access is denied.
error: Could not resolve "C:\\Users\\Lenovo\\AppData\\Local\\Temp\\CodeContext-source-repro-1784098476207\\vitest.config.ts"
    at failureErrorWithLog (C:\Users\Lenovo\AppData\Local\Temp\CodeContext-source-repro-1784098476207\node_modules\.pnpm\esbuild@0.21.5\node_modules\esbuild\lib\main.js:1472:15)
    at C:\Users\Lenovo\AppData\Local\Temp\CodeContext-source-repro-1784098476207\node_modules\.pnpm\esbuild@0.21.5\node

## Clean-source constraints

- Source directory built from git ls-files: 425 files
- Required tracked-file check: PASS
- Isolated pnpm store/cache/HOME/database: PASS

## Commands

| Command | Status | Exit | Duration |
|---|---|---:|---:|
| `git init -q` | PASS | 0 | 197ms |
| `git checkout -q -b main` | PASS | 0 | 131ms |
| `git remote add origin https://github.com/2cux/code-context-mcp` | PASS | 0 | 153ms |
| `git commit --allow-empty -m reproducibility metadata` | PASS | 0 | 255ms |
| `cmd /d /s /c pnpm install --frozen-lockfile` | PASS | 0 | 17397ms |
| `cmd /d /s /c pnpm build` | PASS | 0 | 8093ms |
| `cmd /d /s /c npx vitest run` | FAIL | 1 | 2874ms |

## Required source inventory

- Missing tracked files: none
- Untracked required files: none
