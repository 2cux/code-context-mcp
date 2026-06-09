import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execRaw, initDb } from "./db.js";
import type { Database } from "sql.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the path to schema.sql.
 *
 * Tries:
 *   1. dist/storage/schema.sql  (production build, if copied)
 *   2. src/storage/schema.sql   (development, relative to __dirname)
 */
function findSchemaPath(): string {
  // __dirname is .../src/storage (dev) or .../dist/storage (production).
  // Try sibling first, then walk up to src/.
  const candidates = [
    join(__dirname, "schema.sql"),
    // From dist/storage -> project root -> src/storage/schema.sql
    join(__dirname, "..", "..", "src", "storage", "schema.sql"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  throw new Error(
    `Cannot find schema.sql. Looked in: ${candidates.join(", ")}`,
  );
}

export function runMigrations(db: Database): void {
  const schemaPath = findSchemaPath();
  const schema = readFileSync(schemaPath, "utf-8");
  execRaw(db, schema);
}

export async function initAndMigrate(dbPath?: string): Promise<Database> {
  const db = await initDb(dbPath);
  runMigrations(db);
  return db;
}
