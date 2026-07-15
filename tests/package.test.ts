import { execFileSync, execSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = process.cwd();
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const node = process.execPath;

function run(command: string, args: string[]): string {
  const options = {
    cwd: root,
    encoding: "utf-8" as BufferEncoding,
    stdio: ["ignore", "pipe", "pipe"] as const,
    env: {
      ...process.env,
      npm_config_cache: join(tmpdir(), "code-context-npm-cache"),
    },
  };

  if (process.platform === "win32") {
    return execSync([command, ...args].join(" "), options);
  }

  return execFileSync(command, args, options);
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 7000,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe("release package", () => {
  const tempHomes: string[] = [];
  let server: ChildProcessWithoutNullStreams | null = null;

  beforeAll(() => {
    run(pnpm, ["build"]);
  }, 30000);

  afterAll(() => {
    if (server && !server.killed) {
      server.kill();
    }
    for (const dir of tempHomes) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("copies schema.sql into dist storage", () => {
    expect(existsSync(join(root, "dist", "storage", "schema.sql"))).toBe(true);
  });

  it("includes dist/storage/schema.sql in npm pack dry-run output", () => {
    const output = run(npm, ["pack", "--dry-run", "--json", "--silent"]);
    const jsonStart = output.lastIndexOf("\n[");
    const packed = JSON.parse(jsonStart >= 0 ? output.slice(jsonStart + 1) : output) as Array<{
      files: Array<{ path: string }>;
    }>;

    expect(
      packed[0]?.files.some((file) => file.path === "dist/storage/schema.sql"),
    ).toBe(true);
  });

  it("fails the packed Markdown check when a relative target is missing", () => {
    const fixture = mkdtempSync(join(tmpdir(), "code-context-packed-links-"));
    tempHomes.push(fixture);
    writeFileSync(join(fixture, "README.md"), "[missing](./missing.md)\n", "utf8");

    expect(() => run(node, [
      join(root, "scripts", "release", "check-packed-markdown-links.mjs"),
      "--directory",
      fixture,
    ])).toThrow();
  });

  it("initializes a fresh home database from the packaged dist server", async () => {
    const home = mkdtempSync(join(tmpdir(), "code-context-home-"));
    tempHomes.push(home);
    const dbPath = join(home, ".code-context-mcp", "code-context.sqlite");
    let stderr = "";

    server = spawn(node, [join(root, "dist", "index.js")], {
      cwd: root,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    server.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    await waitFor(() => existsSync(dbPath) || Boolean(server?.exitCode));

    expect(server.exitCode, stderr).toBeNull();
    expect(existsSync(dbPath)).toBe(true);

    server.kill();
    await new Promise((resolve) => server?.once("exit", resolve));

    const SQL = await initSqlJs();
    const db = new SQL.Database(readFileSync(dbPath));
    try {
      const rows = db.exec(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('scopes', 'memories', 'receipts') ORDER BY name",
      );
      expect(rows[0]?.values.map((row) => row[0])).toEqual([
        "memories",
        "receipts",
        "scopes",
      ]);
    } finally {
      db.close();
    }
  }, 15000);
});
