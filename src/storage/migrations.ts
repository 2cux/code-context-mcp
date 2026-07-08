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

/** Current schema version — increment when the schema or migrations change. */
const CURRENT_SCHEMA_VERSION = 4;

/** Read the schema version stored in the database (PRAGMA user_version). */
function getSchemaVersion(db: Database): number {
  try {
    const rows = db.exec("PRAGMA user_version");
    if (rows.length > 0 && rows[0]!.values.length > 0) {
      return Number(rows[0]!.values[0]![0] ?? 0);
    }
  } catch {
    // PRAGMA failed — assume version 0 and run migrations
  }
  return 0;
}

/** Write the current schema version to the database. */
function setSchemaVersion(db: Database, version: number): void {
  db.run(`PRAGMA user_version = ${version}`);
}

export function runMigrations(db: Database): void {
  const currentVersion = getSchemaVersion(db);

  // Fast path: if schema is already current, skip all migration work.
  // The schema.sql execution and per-migration ALTER TABLE attempts are
  // unnecessary repeated work on already-migrated databases.
  if (currentVersion >= CURRENT_SCHEMA_VERSION) return;

  const schemaPath = findSchemaPath();
  const schema = readFileSync(schemaPath, "utf-8");
  execRaw(db, schema);

  // Post-schema migrations for constraint changes that SQLite can't ALTER.
  // Safe to run on fresh databases — checks table state before acting.
  //
  // Order matters: migrateReceiptsRunFields adds the new columns first,
  // then migrateReceiptsConstraint can safely rebuild with all columns.
  migrateReceiptsRunFields(db);
  migrateReceiptsConstraint(db);

  // CacheAligner columns (§31.2) — added in v1.1
  migrateCacheColumns(db);

  // Memory fingerprint column (§39) — added in v1.2
  migrateFingerprintColumn(db);

  // Mark migrations as applied so subsequent initAndMigrate calls skip work
  setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
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
    if (createSql.includes("delete_original") && createSql.includes("cleanup_originals") && createSql.includes("harness_run")) {
      return; // already migrated (including run receipt upgrade)
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
                                  'list', 'harness_run', 'harness_phase',
                                  'harness_checkpoint', 'harness_check',
                                  'harness_artifact'
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
          cache_hit           INTEGER DEFAULT 0,
          timestamp           TEXT NOT NULL,
          run_id              TEXT,
          module_id           TEXT,
          parent_run_id       TEXT,
          phase               TEXT,
          event_type          TEXT,
          checkpoint_name     TEXT,
          artifact_paths      TEXT,
          covered_tools       TEXT,
          FOREIGN KEY (scope_id) REFERENCES scopes(scope_id)
      )`,
    );
    execRaw(db, "INSERT INTO receipts_migrated SELECT id, operation, scope_id, input_hash, query, result_ids, memory_ids, ccr_ids, original_refs, tokens_before, tokens_after, tokens_saved, compression_ratio, compressed, retrieved_original, failed, error_reason, cache_hit, timestamp, run_id, module_id, parent_run_id, phase, event_type, checkpoint_name, artifact_paths, covered_tools FROM receipts");
    execRaw(db, "DROP TABLE receipts");
    execRaw(db, "ALTER TABLE receipts_migrated RENAME TO receipts");
    // Re-create indexes on the new table
    execRaw(db, "CREATE INDEX IF NOT EXISTS idx_rcp_scope ON receipts(scope_id)");
    execRaw(db, "CREATE INDEX IF NOT EXISTS idx_rcp_operation ON receipts(operation)");
    execRaw(db, "CREATE INDEX IF NOT EXISTS idx_rcp_time ON receipts(timestamp)");
    execRaw(db, "CREATE INDEX IF NOT EXISTS idx_rcp_run_id ON receipts(run_id)");
  } catch (migrationErr) {
    // If migration fails, skip — old table stays intact.
    // New operation types will still fail until the DB is recreated.
    console.warn(
      "receipts CHECK constraint migration skipped:",
      migrationErr instanceof Error ? migrationErr.message : String(migrationErr),
    );
  }
}

/**
 * Add CacheAligner columns to compressed_contexts and receipts.
 *
 * SQLite ALTER TABLE only supports ADD COLUMN, so we add each column
 * individually.  All are nullable or have defaults so existing rows
 * are unaffected.
 *
 * The UNIQUE index on cache_key is created separately because
 * IF NOT EXISTS on an index is safe even if the column was just added.
 */
function migrateCacheColumns(db: Database): void {
  const ccrColumns = [
    "content_hash TEXT",
    "cache_key TEXT",
    "strategy_version TEXT",
    "cache_hit_count INTEGER NOT NULL DEFAULT 0",
    "last_accessed_at TEXT",
  ];

  for (const col of ccrColumns) {
    try {
      db.run(`ALTER TABLE compressed_contexts ADD COLUMN ${col}`);
    } catch {
      // Column already exists — safe to ignore
    }
  }

  // Create the unique index (IF NOT EXISTS is safe)
  try {
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_ccr_cache_key ON compressed_contexts(cache_key)`,
    );
  } catch {
    // Index already exists
  }

  // Receipts cache_hit column
  try {
    db.run("ALTER TABLE receipts ADD COLUMN cache_hit INTEGER DEFAULT 0");
  } catch {
    // Column already exists
  }
}

/**
 * Add fingerprint column and index to memories table (§39).
 *
 * SQLite ALTER TABLE only supports ADD COLUMN so we add the column
 * individually, then create the index. Both are safe to re-run
 * (column add fails silently if already exists; IF NOT EXISTS on index).
 */
function migrateFingerprintColumn(db: Database): void {
  try {
    db.run("ALTER TABLE memories ADD COLUMN fingerprint TEXT");
  } catch {
    // Column already exists — safe to ignore
  }

  try {
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_mem_fingerprint ON memories(scope_id, fingerprint)",
    );
  } catch {
    // Index already exists
  }
}

/**
 * Add run receipt fields to the receipts table (§34).
 *
 * Adds 8 nullable columns for harness run tracking.  Then rebuilds the
 * CHECK constraint if the current schema does not include the new harness
 * operation types (SQLite cannot ALTER a CHECK constraint).
 *
 * Also creates the idx_rcp_run_id index for efficient run-level lookups.
 */
function migrateReceiptsRunFields(db: Database): void {
  // ── Phase 1: Add new columns (each individually, safe to re-run) ──────────

  const newColumns = [
    "run_id TEXT",
    "module_id TEXT",
    "parent_run_id TEXT",
    "phase TEXT",
    "event_type TEXT",
    "checkpoint_name TEXT",
    "artifact_paths TEXT",
    "covered_tools TEXT",
  ];

  for (const col of newColumns) {
    try {
      db.run(`ALTER TABLE receipts ADD COLUMN ${col}`);
    } catch {
      // Column already exists — safe to ignore
    }
  }

  // ── Phase 2: Create run_id index ──────────────────────────────────────────

  try {
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_rcp_run_id ON receipts(run_id)",
    );
  } catch {
    // Index already exists
  }

  // ── Phase 3: Rebuild CHECK constraint if needed ───────────────────────────

  try {
    const rows = db.exec(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='receipts'",
    );
    if (!rows.length || !rows[0]!.values.length) return; // no receipts table yet

    const createSql = String(rows[0]!.values[0]![0] ?? "");
    if (createSql.includes("harness_run")) {
      return; // already migrated — CHECK constraint is up to date
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
                                  'list', 'harness_run', 'harness_phase',
                                  'harness_checkpoint', 'harness_check',
                                  'harness_artifact'
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
          cache_hit           INTEGER DEFAULT 0,
          timestamp           TEXT NOT NULL,
          run_id              TEXT,
          module_id           TEXT,
          parent_run_id       TEXT,
          phase               TEXT,
          event_type          TEXT,
          checkpoint_name     TEXT,
          artifact_paths      TEXT,
          covered_tools       TEXT,
          FOREIGN KEY (scope_id) REFERENCES scopes(scope_id)
      )`,
    );
    execRaw(db, "INSERT INTO receipts_migrated SELECT id, operation, scope_id, input_hash, query, result_ids, memory_ids, ccr_ids, original_refs, tokens_before, tokens_after, tokens_saved, compression_ratio, compressed, retrieved_original, failed, error_reason, cache_hit, timestamp, run_id, module_id, parent_run_id, phase, event_type, checkpoint_name, artifact_paths, covered_tools FROM receipts");
    execRaw(db, "DROP TABLE receipts");
    execRaw(db, "ALTER TABLE receipts_migrated RENAME TO receipts");
    // Re-create indexes on the new table
    execRaw(db, "CREATE INDEX IF NOT EXISTS idx_rcp_scope ON receipts(scope_id)");
    execRaw(db, "CREATE INDEX IF NOT EXISTS idx_rcp_operation ON receipts(operation)");
    execRaw(db, "CREATE INDEX IF NOT EXISTS idx_rcp_time ON receipts(timestamp)");
    execRaw(db, "CREATE INDEX IF NOT EXISTS idx_rcp_run_id ON receipts(run_id)");
  } catch (migrationErr) {
    // If migration fails, skip — old table stays intact.
    console.warn(
      "receipts run-fields CHECK constraint migration skipped:",
      migrationErr instanceof Error ? migrationErr.message : String(migrationErr),
    );
  }
}

export async function initAndMigrate(dbPath?: string): Promise<Database> {
  const db = await initDb(dbPath);
  runMigrations(db);
  return db;
}
