# Demo Script — CodeContext MCP v0.2.0-beta

## 1. Scope & Setup
pnpm cli scope

## 2. Compression (9 content types)
# Test output
pnpm cli compress tests/fixtures/vitest-output.txt --max-tokens 500

# Log
pnpm cli compress tests/fixtures/app-log.txt --type log --max-tokens 300

# Build output
pnpm cli compress tests/fixtures/build-output.txt --type command_output --max-tokens 200

# TypeScript code
pnpm cli compress tests/fixtures/sample.ts --max-tokens 300

# JSON response
pnpm cli compress tests/fixtures/response.json --max-tokens 300

# RAG chunks
pnpm cli compress tests/fixtures/rag-chunks.json --max-tokens 300

# Markdown
pnpm cli compress tests/fixtures/readme.md --max-tokens 200

## 3. Original Retrieval & Pagination
pnpm cli retrieve orig_b46e1386
pnpm cli retrieve orig_b46e1386 --offset 0 --limit 100

## 4. Token Stats & List
pnpm cli stats
pnpm cli list-compressions --limit 5

## 5. Memory: Remember
pnpm cli remember --type project_rule \
  --content "Always use TypeScript strict mode. No implicit any." \
  --profile-target static --tags "typescript,convention"

pnpm cli remember --type current_task \
  --content "Implementing Beta v0.2.0 features" \
  --profile-target dynamic --tags "beta"

pnpm cli remember --type decision \
  --content "SQLite chosen for local-first storage" \
  --profile-target static --tags "architecture"

## 6. Memory: Recall
pnpm cli recall "TypeScript"
pnpm cli recall "TypeScript" --type project_rule --profile static
pnpm cli recall "Beta" --type current_task --profile dynamic

## 7. Memory: List
pnpm cli list-context --limit 10
pnpm cli list-context --type project_rule --status active
pnpm cli list-context --type current_task

## 8. Memory: Forget & Supersede
# Soft-forget a memory
pnpm cli forget mem_xxxxxxxx --mode soft_forget --reason "Demo cleanup"

# Supersede old rule with new one
pnpm cli remember --type project_rule \
  --content "Use pnpm v9+ only. No npm or yarn." \
  --profile-target static --tags "build,convention"
# ... capture memoryId of old rule and new rule ...
pnpm cli forget <old_memory_id> --mode supersede \
  --superseded-by <new_memory_id> --reason "Updated package manager policy"

## 9. Profile
pnpm cli profile
pnpm cli profile --static
pnpm cli profile --dynamic

## 10. Receipts (Audit Trail)
pnpm cli receipts --limit 10
pnpm cli receipts --operation remember --limit 5
pnpm cli receipts --operation compress --limit 5

## 11. Original Cleanup
pnpm cli cleanup --originals

## 12. Test Suite
pnpm test
