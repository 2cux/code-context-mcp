#!/usr/bin/env node

/**
 * CodeContext MCP — CLI
 *
 * Usage:
 *   code-context scope                Show current scope
 *   code-context stats                Show token/stats summary
 *   code-context receipt <id>         Show a receipt
 *   code-context compress <file>      Compress a file (Phase 2)
 *   code-context retrieve <ref>       Retrieve original content (Phase 3)
 *   code-context remember ...         Save memory (Phase 5)
 *   code-context recall <query>       Recall memories (Phase 5)
 *   code-context forget <id>          Forget a memory (Phase 5)
 *   code-context list-context         List memories (Phase 5)
 *   code-context cleanup --originals  Clean up old originals (Phase 3)
 */

import { initAndMigrate } from "../storage/migrations.js";
import { getDb, closeDb } from "../storage/db.js";
import { ReceiptService } from "../receipts/receiptService.js";
import { getTokenStats } from "../stats/tokenStats.js";
import { resolveScope } from "../scope/resolveScope.js";

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  // Initialize DB
  await initAndMigrate();
  const db = getDb();
  const receipts = new ReceiptService(db);

  switch (command) {
    case "scope": {
      const cwd = args[1] ?? process.cwd();
      const scope = resolveScope(cwd);
      console.log(JSON.stringify(scope, null, 2));
      break;
    }

    case "stats": {
      const scope = resolveScope();
      const stats = getTokenStats(db, scope.scopeId);
      console.log(JSON.stringify(stats, null, 2));
      break;
    }

    case "receipt": {
      const receiptId = args[1];
      if (!receiptId) {
        console.error("Usage: code-context receipt <receiptId>");
        closeDb();
        process.exit(1);
      }
      const receipt = receipts.get(receiptId);
      if (!receipt) {
        console.error(`Receipt not found: ${receiptId}`);
        closeDb();
        process.exit(1);
      }
      console.log(JSON.stringify(receipt, null, 2));
      break;
    }

    case "compress":
    case "retrieve":
    case "remember":
    case "recall":
    case "forget":
    case "list-context":
    case "cleanup": {
      console.log(
        `Command "${command}" is not yet implemented (coming in a future phase).`,
      );
      break;
    }

    default: {
      console.log(`CodeContext MCP CLI v0.1.0

Usage:
  code-context scope                 Show current repo scope
  code-context stats                 Show token and operation stats
  code-context receipt <id>          Show a receipt by ID

Coming soon:
  code-context compress <file>       Compress context
  code-context retrieve <ref>        Retrieve original content
  code-context remember ...          Save project memory
  code-context recall <query>        Recall project memories
  code-context forget <id>           Forget a memory
  code-context list-context          List all memories
  code-context cleanup --originals   Clean up expired originals`);
      break;
    }
  }

  closeDb();
}

main().catch((err) => {
  console.error("CLI error:", err);
  process.exit(1);
});
