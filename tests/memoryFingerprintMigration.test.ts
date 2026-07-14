import { describe, it, expect, afterEach } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import { runMigrations } from "../src/storage/migrations.js";
import { computeMemoryFingerprint } from "../src/memory/fingerprint.js";
import { MemoryService } from "../src/memory/memoryService.js";

const SCOPE = "mig_scope";
const NOW = "2026-01-01T00:00:00.000Z";

function installOldSchema(db: Database, withFingerprint = false): void {
  db.exec(`
    CREATE TABLE scopes (
      scope_id       TEXT PRIMARY KEY,
      git_root       TEXT,
      remote         TEXT,
      branch         TEXT,
      cwd            TEXT NOT NULL,
      scope_strategy TEXT NOT NULL,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    CREATE TABLE memories (
      id            TEXT PRIMARY KEY,
      scope_id      TEXT NOT NULL,
      type          TEXT NOT NULL,
      content       TEXT NOT NULL,
      summary       TEXT,
      source_ref    TEXT,
      confidence    REAL NOT NULL DEFAULT 0.8,
      status        TEXT NOT NULL DEFAULT 'active',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      expires_at    TEXT,
      superseded_by TEXT,
      tags          TEXT${withFingerprint ? ",\n      fingerprint   TEXT" : ""}
    );

    PRAGMA user_version = 4;
  `);

  db.run(
    `INSERT INTO scopes (scope_id, cwd, scope_strategy, created_at, updated_at)
     VALUES (?, ?, 'cwdFallback', ?, ?)`,
    [SCOPE, `/tmp/${SCOPE}`, NOW, NOW],
  );
}

function insertMemory(
  db: Database,
  id: string,
  content: string,
  opts: { status?: string; fingerprint?: string | null } = {},
): void {
  const columns = [
    "id", "scope_id", "type", "content", "summary", "source_ref",
    "confidence", "status", "created_at", "updated_at",
    "expires_at", "superseded_by", "tags",
  ];
  const values: unknown[] = [
    id, SCOPE, "project_rule", content, null, null,
    0.8, opts.status ?? "active", NOW, NOW,
    null, null, null,
  ];

  if (opts.fingerprint !== undefined) {
    columns.push("fingerprint");
    values.push(opts.fingerprint);
  }

  db.run(
    `INSERT INTO memories (${columns.join(", ")})
     VALUES (${columns.map(() => "?").join(", ")})`,
    values,
  );
}

function getMemoryRows(db: Database): Record<string, unknown>[] {
  const stmt = db.prepare("SELECT id, status, fingerprint FROM memories ORDER BY id");
  const rows: Record<string, unknown>[] = [];
  try {
    while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>);
  } finally {
    stmt.free();
  }
  return rows;
}

describe("Memory fingerprint migration", () => {
  let db: Database | null = null;

  afterEach(() => {
    db?.close();
    db = null;
  });

  it("upgrades an old database and backfills empty fingerprints without merging duplicates", async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    installOldSchema(db);
    insertMemory(db, "mem_a", "  Use pnpm.\r\n\r\n\r\n");
    insertMemory(db, "mem_b", "Use pnpm.");
    insertMemory(db, "mem_c", "Use pnpm.", { status: "forgotten" });

    const summary = runMigrations(db);

    expect(summary.memoryFingerprint).toEqual({
      eligibleRows: 3,
      backfilledRows: 3,
      preservedRows: 0,
      activeDuplicateGroups: 1,
      activeDuplicateRows: 2,
    });
    expect(db.exec("PRAGMA table_info(memories)")[0]!.values.some((v) => v[1] === "fingerprint")).toBe(true);
    expect(db.exec("SELECT COUNT(*) FROM memories")[0]!.values[0]![0]).toBe(3);

    const rows = getMemoryRows(db);
    expect(rows.every((row) => typeof row["fingerprint"] === "string" && row["fingerprint"] !== "")).toBe(true);
    expect(rows[0]!["fingerprint"]).toBe(rows[1]!["fingerprint"]);
  });

  it("is idempotent when the migration is run repeatedly", async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    installOldSchema(db);
    insertMemory(db, "mem_a", "Use pnpm.");
    insertMemory(db, "mem_b", "Use vitest.");

    runMigrations(db);
    const firstRows = getMemoryRows(db);

    db.run("PRAGMA user_version = 4");
    const second = runMigrations(db);

    expect(second.memoryFingerprint.eligibleRows).toBe(0);
    expect(second.memoryFingerprint.backfilledRows).toBe(0);
    expect(second.memoryFingerprint.preservedRows).toBe(2);
    expect(getMemoryRows(db)).toEqual(firstRows);
  });

  it("does not overwrite an existing fingerprint", async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    installOldSchema(db, true);
    insertMemory(db, "mem_existing", "Use pnpm.", { fingerprint: "existing-fingerprint" });
    insertMemory(db, "mem_empty", "Use vitest.", { fingerprint: "" });

    const summary = runMigrations(db);
    const rows = getMemoryRows(db);

    expect(summary.memoryFingerprint.eligibleRows).toBe(1);
    expect(summary.memoryFingerprint.backfilledRows).toBe(1);
    expect(summary.memoryFingerprint.preservedRows).toBe(1);
    expect(rows.find((r) => r["id"] === "mem_existing")!["fingerprint"]).toBe("existing-fingerprint");
    expect(rows.find((r) => r["id"] === "mem_empty")!["fingerprint"]).toBe(
      computeMemoryFingerprint(SCOPE, "project_rule", "Use vitest."),
    );
  });

  it("lets new remember calls deduplicate against upgraded old records", async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    installOldSchema(db);
    insertMemory(db, "mem_old", "Use pnpm.");
    runMigrations(db);

    const service = new MemoryService(db);
    const result = service.remember({
      scopeId: SCOPE,
      type: "project_rule",
      content: "  Use pnpm.  ",
    });

    expect(result.action).toBe("deduplicated");
    expect(result.memoryId).toBe("mem_old");
    expect(db.exec("SELECT COUNT(*) FROM memories")[0]!.values[0]![0]).toBe(1);
  });
});
