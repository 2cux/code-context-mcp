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

  // Post-schema migrations for constraint changes that SQLite can't ALTER.
  // Safe to run on fresh databases — checks table state before acting.
  migrateReceiptsConstraint(db);
}

/**
 * Ensure the receipts.operation CHECK constraint includes the full set of
 * operation types.  SQLite cannot ALTER a CHECK constraint, so on databases
 * created before delete_original / cleanup_originals were added we must
 * recreate the table.
 *
 * Detection strategy: read the CREATE TABLE SQL from sqlite_master and check
 * whether it already includes the new operation names.  This avoids probing
 * with a live INSERT (which would fail FK checks on scope_id).
 */
function migrateReceiptsConstraint(db: Database): void {
  try {
    const rows = db.exec(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='receipts'",
    );
    if (!rows.length || !rows[0]!.values.length) return; // no receipts table yet

    const createSql = String(rows[0]!.values[0]![0] ?? "");
    if (createSql.includes("delete_original") && createSql.includes("cleanup_originals")) {
      return; // already migrated
    }
  } catch {
    return; // can't read schema — skip migration
  }

  // Recreate the table with the updated constraint.
  try {
    execRaw(
      db,
      `CREATE TABLE IF NOT EXISTS receipts_migrated (
          id                  TEXT PRIMARY KEY,
          operation           TEXT NOT NULL CHECK (operation IN (
                                  'compress', 'retrieve_original', 'delete_original',
                                  'cleanup_originals', 'remember', 'recall', 'forget',
                                  'list'
                              )),
          scope_id            TEXT NOT NULL,
          input_hash          TEXT,
          query               TEXT,
          result_ids          TEXT,
          memory_ids          TEXT,
          ccr_ids             TEXT,
          original_refs       TEXT,
          tokens_before       INTEGER,
          tokens_after        INTEGER,
          tokens_saved        INTEGER,
          compression_ratio   REAL,
          compressed          INTEGER,
          retrieved_original  INTEGER,
          failed              INTEGER DEFAULT 0,
          error_reason        TEXT,
          timestamp           TEXT NOT NULL,
          FOREIGN KEY (scope_id) REFERENCES scopes(scope_id)
      )`,
    );
    execRaw(db, "INSERT INTO receipts_migrated SELECT * FROM receipts");
    execRaw(db, "DROP TABLE receipts");
    execRaw(db, "ALTER TABLE receipts_migrated RENAME TO receipts");
  } catch (migrationErr) {
    // If migration fails, skip — old table stays intact.
    // New operation types will still fail until the DB is recreated.
    console.warn(
      "receipts CHECK constraint migration skipped:",
      migrationErr instanceof Error ? migrationErr.message : String(migrationErr),
    );
  }
}

export async function initAndMigrate(dbPath?: string): Promise<Database> {
  const db = await initDb(dbPath);
  runMigrations(db);
  return db;
}
