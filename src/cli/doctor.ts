/**
 * CodeContext CLI — Doctor Command
 *
 * Installation and environment health check.
 * Verifies 7 checks and outputs a copyable MCP client configuration.
 *
 * All checks are read-only and do not modify any database state.
 * Returns a CliResult (never throws, never calls process.exit).
 *
 * Usage:
 *   code-context doctor
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { resolveScope } from "../scope/resolveScope.js";
import { resolveToolMode, getAllowedTools, describeMode } from "../mcp/toolMode.js";
import type { ToolMode } from "../mcp/toolMode.js";
import { initAndMigrate } from "../storage/migrations.js";
import { getDb, closeDb } from "../storage/db.js";
import type { CliResult } from "./commands.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DoctorCheck {
  name: string;
  label: string;
  status: "pass" | "warn" | "fail";
  message: string;
  detail?: string;
}

export interface DoctorReport {
  timestamp: string;
  nodeVersion: string;
  platform: string;
  checks: DoctorCheck[];
  allPass: boolean;
  mcpConfig: {
    agent: McpServerConfig;
    dev: McpServerConfig;
  };
}

export interface McpServerConfig {
  command: string;
  args: string[];
  env: { MCP_TOOL_MODE: "agent" | "dev" };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(data: unknown): CliResult {
  return { status: "ok", data };
}

function fail(message: string): CliResult {
  return { status: "error", data: null, error: message };
}

function safeString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

const REQUIRED_NODE_MAJOR = 18;

function checkNodeVersion(): DoctorCheck {
  const major = process.versions.node ? parseInt(process.versions.node.split(".")[0]!, 10) : 0;
  const full = process.version;

  if (major >= REQUIRED_NODE_MAJOR) {
    return {
      name: "node-version",
      label: "Node version",
      status: "pass",
      message: `${full} (>= ${REQUIRED_NODE_MAJOR}.0.0)`,
    };
  }

  return {
    name: "node-version",
    label: "Node version",
    status: "fail",
    message: `${full} — requires >= ${REQUIRED_NODE_MAJOR}.0.0`,
    detail: `Upgrade Node.js to ${REQUIRED_NODE_MAJOR}.0.0 or later: https://nodejs.org`,
  };
}

export function checkDbDirWritable(
  dir = join(homedir(), ".code-context-mcp"),
): DoctorCheck {

  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  } catch {
    return {
      name: "db-dir-writable",
      label: "Database directory writable",
      status: "fail",
      message: `Cannot create directory: ${dir}`,
      detail: "Check filesystem permissions and disk space.",
    };
  }

  // Write-then-delete a temp file to verify writability
  const probe = join(dir, `.doctor-probe-${randomBytes(4).toString("hex")}`);
  try {
    writeFileSync(probe, "doctor", "utf-8");
    unlinkSync(probe);
  } catch {
    return {
      name: "db-dir-writable",
      label: "Database directory writable",
      status: "fail",
      message: `Directory exists but is not writable: ${dir}`,
      detail: "Check filesystem permissions and disk space.",
    };
  }

  return {
    name: "db-dir-writable",
    label: "Database directory writable",
    status: "pass",
    message: dir,
  };
}

export async function checkMigration(
  migrate: typeof initAndMigrate = initAndMigrate,
  getDatabase: typeof getDb = getDb,
  closeDatabase: typeof closeDb = closeDb,
): Promise<DoctorCheck> {
  // Use a temp in-memory DB path so we don't touch the real database
  const tmpPath = join(tmpdir(), `code-context-doctor-${randomBytes(4).toString("hex")}.sqlite`);

  try {
    await migrate(`:memory:`);
    const db = getDatabase();

    // Verify key tables exist (schema was applied)
    const tables = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const tableNames = tables.length > 0
      ? tables[0]!.values.map((r) => String(r[0]!))
      : [];

    closeDatabase();

    const required = ["scopes", "compressed_contexts", "original_contents", "memories", "receipts"];
    const missing = required.filter((t) => !tableNames.includes(t));

    if (missing.length > 0) {
      // Clean up temp file if it was created
      try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ok */ }
      return {
        name: "migration",
        label: "Schema migration",
        status: "fail",
        message: `Missing tables: ${missing.join(", ")}`,
        detail: "Run `code-context scope` to trigger migration, or check schema.sql.",
      };
    }

    return {
      name: "migration",
      label: "Schema migration",
      status: "pass",
      message: `${tableNames.length} tables (${required.join(", ")}) present`,
    };
  } catch (err) {
    // Clean up temp file
    try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* ok */ }
    return {
      name: "migration",
      label: "Schema migration",
      status: "fail",
      message: safeString(err),
      detail: "Check that sql.js is installed and schema.sql is bundled.",
    };
  }
}

function checkScope(): DoctorCheck {
  try {
    const scope = resolveScope();
    return {
      name: "scope",
      label: "Project scope resolution",
      status: "pass",
      message: `${scope.scopeId} (strategy: ${scope.scopeStrategy})`,
      detail: `gitRoot=${scope.gitRoot ?? "(none)"}  remote=${scope.remote ?? "(none)"}`,
    };
  } catch (err) {
    return {
      name: "scope",
      label: "Project scope resolution",
      status: "fail",
      message: safeString(err),
      detail: "Ensure you are in a git repository or a readable directory.",
    };
  }
}

async function checkMcpInit(): Promise<DoctorCheck> {
  // Verify that the MCP server module can be loaded and constructed
  // without actually binding to stdio. We test Server + SDK availability.
  try {
    // Dynamic import to avoid side effects of the server module loading.
    // Just verify the Server class is constructable.
    const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
    const name = "code-context-mcp";

    // Construct a server — this verifies the SDK is available and callable.
    // We do NOT call server.connect() — no transport is started.
    const srv = new Server(
      { name, version: "1.0.0" },
      { capabilities: { tools: {} } },
    );

    // Verify we can register a handler (exercises the SDK API surface)
    const { ListToolsRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
    srv.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));

    return {
      name: "mcp-init",
      label: "MCP server initialization",
      status: "pass",
      message: `Server "${name}" constructable, SDK v1.x available`,
    };
  } catch (err) {
    return {
      name: "mcp-init",
      label: "MCP server initialization",
      status: "fail",
      message: safeString(err),
      detail:
        "Check that @modelcontextprotocol/sdk is installed: npm install @modelcontextprotocol/sdk",
    };
  }
}

export function checkToolMode(): DoctorCheck {
  const rawMode = (process.env["MCP_TOOL_MODE"] ?? "").trim().toLowerCase();
  if (rawMode && !new Set(["agent", "dev", "test"]).has(rawMode)) {
    return {
      name: "tool-mode",
      label: "MCP_TOOL_MODE parsing",
      status: "fail",
      message: `Invalid MCP_TOOL_MODE: ${rawMode}`,
      detail: "Expected one of: agent, dev, test.",
    };
  }

  let mode: ToolMode;
  try {
    mode = resolveToolMode();
  } catch (err) {
    return {
      name: "tool-mode",
      label: "MCP_TOOL_MODE parsing",
      status: "fail",
      message: safeString(err),
    };
  }

  const desc = describeMode(mode);
  const envValue = process.env["MCP_TOOL_MODE"] ?? "(unset)";

  return {
    name: "tool-mode",
    label: "MCP_TOOL_MODE parsing",
    status: "pass",
    message: `${mode} (env: ${envValue})`,
    detail: desc,
  };
}

function checkAgentToolCount(): DoctorCheck {
  const agentTools = getAllowedTools("agent");

  // Count tools — the Set has a known size for agent mode
  const count = agentTools.size;

  if (count !== 7) {
    return {
      name: "agent-tools",
      label: "Agent mode tool count",
      status: "fail",
      message: `Agent mode exposes ${count} tools, expected exactly 7`,
      detail: `Tools: ${[...agentTools].sort().join(", ")}`,
    };
  }

  return {
    name: "agent-tools",
    label: "Agent mode tool count",
    status: "pass",
    message: `7 tools exposed in agent mode`,
    detail: [...agentTools].sort().join(", "),
  };
}

export function buildMcpConfig(): DoctorReport["mcpConfig"] {
  return {
    agent: {
      command: "code-context-server",
      args: [],
      env: { MCP_TOOL_MODE: "agent" },
    },
    dev: {
      command: "code-context-server",
      args: [],
      env: { MCP_TOOL_MODE: "dev" },
    },
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runDoctor(): Promise<CliResult> {
  const checks: DoctorCheck[] = [];

  // Check 1: Node version (sync)
  checks.push(checkNodeVersion());

  // Check 2: DB directory writable (sync)
  checks.push(checkDbDirWritable());

  // Check 3: Migration (async — uses in-memory DB)
  checks.push(await checkMigration());

  // Check 4: Scope resolution (sync)
  checks.push(checkScope());

  // Check 5: MCP server init (async — loads SDK)
  checks.push(await checkMcpInit());

  // Check 6: MCP_TOOL_MODE parsing (sync)
  checks.push(checkToolMode());

  // Check 7: Agent mode tool count (sync)
  checks.push(checkAgentToolCount());

  const allPass = checks.every((c) => c.status === "pass");

  const report: DoctorReport = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: `${process.platform} ${process.arch}`,
    checks,
    allPass,
    mcpConfig: buildMcpConfig(),
  };

  if (!allPass) {
    const failed = checks
      .filter((check) => check.status !== "pass")
      .map((check) => `${check.name}: ${check.message}`)
      .join("; ");
    return { status: "error", data: report, error: failed || "Doctor checks failed" };
  }

  return ok(report);
}
