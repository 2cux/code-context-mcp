import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from "sql.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export type { Database, SqlValue };

let _db: Database | null = null;
let _SQL: SqlJsStatic | null = null;
let _dbPath: string | null = null;

// ============================================================================
// Init / lifecycle
// ============================================================================

function defaultDbPath(): string {
  const dir = join(homedir(), ".code-context-mcp");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, "code-context.sqlite");
}

export async function initDb(dbPath?: string): Promise<Database> {
  if (_db) return _db;

  if (!_SQL) {
    _SQL = await initSqlJs();
  }

  const path = dbPath ?? process.env.CODECONTEXT_DB_PATH ?? defaultDbPath();
  _dbPath = path;

  const parent = dirname(path);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }

  if (existsSync(path)) {
    const buffer = readFileSync(path);
    _db = new _SQL.Database(buffer);
  } else {
    _db = new _SQL.Database();
  }

  _db.run("PRAGMA foreign_keys = ON");
  return _db;
}

export function getDb(): Database {
  if (!_db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return _db;
}

export function persistDb(): void {
  // :memory: databases cannot and should not be persisted to disk
  if (!_db || !_dbPath || _dbPath === ":memory:") return;
  const data = _db.export();
  writeFileSync(_dbPath, Buffer.from(data));
}

export function closeDb(): void {
  if (_db) {
    persistDb();
    _db.close();
    _db = null;
    _dbPath = null;
  }
}

// ============================================================================
// Query helpers
// ============================================================================

/** Execute a SELECT and return all rows as objects. Uses ? positional params. */
export function queryAll(
  db: Database,
  sql: string,
  params: SqlValue[] = [],
): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject() as Record<string, unknown>);
  }
  stmt.free();
  return rows;
}

/** Execute a SELECT and return the first row, or null. */
export function queryOne(
  db: Database,
  sql: string,
  params: SqlValue[] = [],
): Record<string, unknown> | null {
  const rows = queryAll(db, sql, params);
  return rows[0] ?? null;
}

/** Execute an INSERT / UPDATE / DELETE. Uses ? positional params. */
export function runStmt(
  db: Database,
  sql: string,
  params: SqlValue[] = [],
): void {
  db.run(sql, params);
}

/** Execute raw SQL (schema DDL, multi-statement). */
export function execRaw(db: Database, sql: string): void {
  db.exec(sql);
}
