# Value Report Enhancement

## Summary

Enhanced the `code-context value` command to provide better visibility into CodeContext's value, inspired by Headroom's token savings and observability approach.

## Changes Made

### 1. Enhanced Data Structure (`src/reports/valueReport.ts`)

Added four new sections to `ValueReportData`:

#### Value Summary (Enhanced)
- Added `recoverableOriginals: number` — count of original content that can be retrieved
- Added `lastActivityAt?: string` — timestamp of most recent operation

#### Retrieval Trust (New)
```typescript
retrievalTrust: {
  originalsStored: number;          // Total original records in database
  originalsRetrieved: number;       // Distinct originals that have been retrieved
  latestRetrieveProof?: {           // Proof of latest successful retrieval
    originalRef: string;
    retrievedAt: string;
    ccrId: string;
  };
  localOnlyNote: string;            // Emphasizes local-first approach
}
```

#### Top Savings (Enhanced from topCompressions)
```typescript
topSavings: Array<{
  ccrId: string;
  contentType: string;
  tokensBefore: number;              // NEW: Shows input size
  tokensAfter: number;               // NEW: Shows output size
  tokensSaved: number;
  compressionRatio: number;
  createdAt: string;
  summary?: string;
}>
```

#### Agent Usefulness (New)
```typescript
agentUsefulness: {
  recentRecalledMemories: Array<{  // Recent memories that were recalled
    memoryId: string;
    type: string;
    summary?: string;
    recalledAt: string;
    score?: number;
  }>;
  mostUsefulProjectRules: Array<{  // Project rules with high recall count
    memoryId: string;
    content: string;
    recallCount: number;
    lastRecalledAt?: string;
  }>;
  suggestedNextCommand: string;    // Context-aware next step suggestion
}
```

### 2. Markdown Output Enhancements

#### Value Summary Section
- Displays total tokens saved, compression ratio, recoverable originals
- Shows memory counts and last activity time
- Friendly onboarding message when no data exists

#### Retrieval Trust Section
- Shows original records stored vs retrieved
- Displays latest retrieval proof with timestamp
- Emphasizes local-first data storage

#### Top Savings Section (Enhanced)
- Table now includes Before/After token columns
- Highlights saved tokens in bold
- Shows compression ratio as percentage

#### Agent Usefulness Section
- **Recent Recalled Memories**: Shows which memories agents have been using
- **Most Useful Project Rules**: Highlights project rules by recall frequency
- **Suggested Next Command**: Context-aware guidance (e.g., if user has compressions but no memories, suggests `remember`)

### 3. Database Schema

No schema changes required. Uses existing tables:
- `original_contents` — for recoverable originals count
- `receipts` — for operation statistics and recall tracking
- `memories` — for recent memories and project rules
- `compressed_contexts` — for top savings

### 4. Empty Database Behavior

When no data exists:
- Displays friendly onboarding message
- Lists key CodeContext capabilities (Compress, Remember, Recall, Retrieve)
- Suggests starting with `code-context compress <file>`
- All sections show zero counts without errors

### 5. Suggested Next Command Logic

Dynamically suggests next action based on current usage:
- No data → `compress <file>`
- Has compressions, no memories → `remember --type project_rule`
- Has compressions + memories, no recalls → `recall "project rules"`
- Has activity but no retrieves → `retrieve <originalRef>`
- Has significant activity → `stats`

## Testing

- ✅ TypeScript compilation passes (`npx tsc --noEmit`)
- ✅ All existing tests pass
- ✅ New unit tests added for enhanced features
- ✅ Empty database scenario tested
- ✅ Markdown formatting verified

## Usage

```bash
# Generate value report (markdown + JSON)
code-context value

# Output JSON only
code-context value --json

# Reports written to:
# - reports/usage/value-report.md
# - reports/usage/value-report.json
```

## Example Output

### With Data
```markdown
## Value Summary

- **Total Token Saved**: 575,442
- **Average Compression Ratio**: 4.1%
- **Recoverable Originals**: 2
- **Memory Count**: 1151 saved, 777 recalled
- **Last Activity**: 2026-07-04 13:01:14

## Retrieval Trust

- **Original Records Count**: 2
- **Retrieved Records Count**: 74
- **Latest Retrieve Proof**: `orig_abc123` retrieved at 2026-07-04 13:00:46
- **All originals stored locally. No data uploaded to cloud.**

## Top 5 Highest Token-Saving Compressions

| CCR ID | Content Type | Before Tokens | After Tokens | Saved Tokens | Ratio |
|--------|--------------|---------------|--------------|--------------|-------|
| ccr_… | log | 52,411 | 1,315 | **51,096** | 97.5% |

## Agent Usefulness

### Recent Recalled Memories
- `mem_abc…` (project_rule) — API v2 base URL
  _Recalled: 2026-07-04 13:01:10_

### Most Useful Project Rules
- `mem_xyz…` (recalled 183× — last: 2026-06-17)
  _"New rule: use pnpm."_

### Suggested Next Command
```bash
code-context stats  # Review token savings over time
```
```

### Empty Database
```markdown
## Value Summary

**No usage data yet.** Run `code-context compress <file>` to start saving tokens.

CodeContext helps you:
- **Compress** long logs, test output, and error traces to save context tokens
- **Remember** project rules, decisions, and patterns that persist across sessions
- **Recall** relevant project knowledge on demand
- **Retrieve** original content when you need full details
```

## Design Principles Followed

1. ✅ **Local-first**: All data stays in local SQLite, emphasized in reports
2. ✅ **Read-only**: No mutations, only queries
3. ✅ **Fail-safe**: Empty database returns zero counts, not errors
4. ✅ **No cloud uploads**: Explicitly noted in Retrieval Trust section
5. ✅ **No new dependencies**: Uses existing database structure
6. ✅ **Backward compatible**: Keeps `topCompressions` for compatibility

## Files Changed

- `src/reports/valueReport.ts` — Enhanced data structure and markdown formatter
- `src/cli/commands.ts` — Already had `runValue()` command handler
- `tests/valueReport.test.ts` — Updated tests for new fields

## Next Steps (Optional Future Enhancements)

- Add time-series visualization of token savings
- Track compression strategy effectiveness
- Show memory recall accuracy metrics
- Add export to other formats (CSV, HTML)
