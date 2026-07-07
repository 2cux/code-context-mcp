# Project Profile Optimization Report

**Date**: 2026-07-07  
**Goal**: Optimize `codecontext://project-profile` for better user readability, following Supermemory's project/container pattern

---

## Changes Summary

### 1. User-Friendly Top-Level Fields

**Before**: Internal implementation details exposed at top level
```json
{
  "projectIdentity": {
    "scopeId": "codecontext-mcp",
    "scopeStrategy": "git-repo",
    "gitRoot": "/path/to/repo",
    "remote": "https://github.com/user/repo.git"
  }
}
```

**After**: User-friendly fields promoted to top level
```json
{
  "projectName": "CodeContext",
  "projectRootName": "CodeContext",
  "branch": "main",
  "localFirstNote": "Local-first storage. No project code, logs, or memory uploaded.",
  "_internal": {
    "scopeId": "codecontext-mcp",
    "scopeStrategy": "git-repo",
    "gitRoot": "/path/to/repo",
    "remote": "https://github.com/user/repo.git"
  }
}
```

**Impact**: Agents now see "current project context" instead of internal scope/hash/storage implementation.

---

### 2. Accurate Active Memory Count

**Before**: `memoryOverview.active` returned the length of recent memories list (limited to 10)
```typescript
memoryOverview: {
  total: recentMemories.total,
  active: recentMemories.items.length,  // Wrong!
}
```

**After**: Direct database query for true active count
```typescript
const activeMemoryCount = queryOne(
  db,
  `SELECT COUNT(*) as cnt FROM memories WHERE scope_id = ? AND status = 'active'`,
  [scope.scopeId],
);
const activeCount = Number(activeMemoryCount?.["cnt"] ?? 0);

memoryOverview: {
  total: totalCount,
  active: activeCount,  // Correct!
}
```

**Impact**: Accurate metrics regardless of display limits.

---

### 3. Size Limits to Prevent Bloat

**Before**: No explicit limits on returned arrays
- `stableProjectRules`: returned all matching rules
- `recentActivity`: returned all matching activities

**After**: Strict limits enforced
```typescript
stableProjectRules: topStaticFacts.slice(0, 5).map(...),
recentActivity: recentDynamicFacts.slice(0, 3).map(...),
importantMemories: recentMemories.items.slice(0, 5).map(...),
```

**Impact**: 
- `stableProjectRules`: max 5 items
- `recentActivity`: max 3 items
- `importantMemories`: max 5 items
- Resource stays compact even with many memories

---

### 4. Optimized Prompt Token Budget

**Before**: 
- Memory list limit: 10
- Rule summary truncation: 80 chars
- Memory summary truncation: 60 chars

**After**:
- Memory list limit: 5 (reduced from 10)
- Rule summary truncation: 60 chars (reduced from 80)
- Memory summary truncation: 50 chars (reduced from 60)
- Project name extraction: shows "CodeContext" instead of full scopeId

**Impact**: `project_context_brief` stays well under 800 tokens target.

---

### 5. Internal Fields Moved to `_internal`

**Before**: All scope implementation details at top level
```json
{
  "projectIdentity": {
    "scopeId": "...",
    "scopeStrategy": "...",
    "gitRoot": "...",
    "remote": "..."
  }
}
```

**After**: Hidden under `_internal` for debugging only
```json
{
  "projectName": "CodeContext",
  "_internal": {
    "scopeId": "...",
    "scopeStrategy": "...",
    "gitRoot": "...",
    "remote": "..."
  }
}
```

**Impact**: Primary display shows user-facing context; internal details available for debugging.

---

## Test Coverage

### New Tests Added

1. **Empty project output**: Verifies graceful handling with no data
2. **Demo data output**: Verifies structure with populated data
3. **No internal hash as primary display**: Verifies scopeId not at top level
4. **Accurate active memory count**: Verifies count matches database, not list length
5. **Size limits enforced**: Verifies max 5 rules, max 3 activities
6. **Top-level fields present**: Verifies `projectName`, `projectRootName`, `branch`, `localFirstNote`

### Test Results

```
✓ tests/mcp/resourceHandlers.test.ts (9 tests)
  ✓ should return project-profile resource with enhanced structure
  ✓ should return project-stats resource with summary counts
  ✓ should handle empty project gracefully
  ✓ should limit stableProjectRules to 5 items
  ✓ should limit recentActivity to 3 items
  ✓ should show accurate active memory count
  ✓ should throw error for unknown resource URI
  ✓ should only show agent-mode tools in project-profile (7 tools)

✓ tests/mcp/promptHandlers.test.ts (5 tests)
  ✓ should return project_context_brief with formatted text under 800 tokens
  ✓ should handle empty project gracefully
  ✓ should throw error for unknown prompt
  ✓ should only show agent-mode tools in project_context_brief (7 tools)

Test Files: 2 passed (2)
Tests: 14 passed (14)
```

---

## Files Modified

1. **src/mcp/resourceHandlers.ts**
   - Refactored `getProjectProfile()` function
   - Added project name extraction from git root/remote
   - Added separate queries for accurate memory counts
   - Moved internal fields to `_internal` object
   - Enforced size limits with `.slice(0, N)`

2. **src/mcp/promptHandlers.ts**
   - Refactored `buildProjectContextBrief()` function
   - Added project name extraction
   - Reduced memory list limit from 10 to 5
   - Reduced summary truncation lengths
   - Updated to show projectName instead of scopeId

3. **tests/mcp/resourceHandlers.test.ts**
   - Updated assertions to check new structure
   - Added tests for size limits
   - Added test for accurate active count
   - Added tests for top-level fields
   - Removed assertions on removed fields

4. **tests/mcp/promptHandlers.test.ts**
   - Updated assertions to check for projectName
   - Removed assertions on scopeId display

5. **docs/project-context-resources.md**
   - Updated documentation to reflect new structure
   - Updated before/after comparison
   - Documented size limits and count accuracy

---

## Verification Checklist

- [x] Type check passes: `npx tsc --noEmit`
- [x] Tests pass: `npx vitest run tests/mcp/resourceHandlers.test.ts tests/mcp/promptHandlers.test.ts`
- [x] Empty project output works
- [x] Demo data output works
- [x] No internal hash as primary display
- [x] Active memory count is accurate
- [x] stableProjectRules limited to 5
- [x] recentActivity limited to 3
- [x] project_context_brief under 800 tokens
- [x] Documentation updated

---

## Impact on Agents

### What Agents See Now

**Resource View**:
```json
{
  "projectName": "CodeContext",
  "branch": "main",
  "localFirstNote": "Local-first storage...",
  "stableProjectRules": [...],
  "memoryOverview": { "active": 12, "total": 15 }
}
```

**Prompt View**:
```markdown
## Current Project
Project: `CodeContext`
Branch: main

**Local-first constraint**: Do not upload...
```

### Benefits

1. **Clearer context**: Agents see project name, not internal scopeId
2. **Accurate metrics**: Memory counts reflect true database state
3. **Bounded size**: Resources stay compact even with many memories
4. **Better UX**: Human-readable project identity
5. **Debugging preserved**: Internal details still accessible in `_internal`

---

## Alignment with Supermemory Pattern

✅ **Project/container abstraction**: Top-level fields represent project, not storage  
✅ **User-friendly naming**: projectName, projectRootName instead of scopeId  
✅ **Internal details hidden**: Implementation moved to `_internal`  
✅ **Accurate counts**: Database queries, not list lengths  
✅ **Size limits**: Explicit bounds prevent resource bloat  
✅ **Token budget**: Brief prompt stays under 800 tokens

---

## Next Steps (Optional)

Future enhancements not in current scope:

1. **Project avatar/icon**: Extract from repo metadata
2. **Project description**: Parse from README.md first paragraph
3. **Team members**: Extract from git commit authors
4. **Project tags**: Infer from tech stack/languages used
5. **Project health**: Derive from memory freshness, compression ratio

---

## Conclusion

The `codecontext://project-profile` resource is now optimized for agent readability:
- User-friendly project identity at top level
- Accurate memory counts from database
- Size limits prevent bloat
- Internal details preserved for debugging
- Follows Supermemory's project/container pattern

All tests pass and documentation is updated.
