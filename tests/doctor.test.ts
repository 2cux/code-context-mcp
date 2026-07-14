import { describe, expect, it, afterEach } from "vitest";
import { join } from "node:path";
import {
  checkDbDirWritable,
  checkMigration,
  checkToolMode,
  runDoctor,
} from "../src/cli/doctor.js";

const originalToolMode = process.env["MCP_TOOL_MODE"];

afterEach(() => {
  if (originalToolMode === undefined) {
    delete process.env["MCP_TOOL_MODE"];
  } else {
    process.env["MCP_TOOL_MODE"] = originalToolMode;
  }
});

describe("doctor failure semantics", () => {
  it("reports migration failures as failed checks", async () => {
    const result = await checkMigration(async () => {
      throw new Error("synthetic migration failure");
    });

    expect(result.status).toBe("fail");
    expect(result.message).toContain("synthetic migration failure");
  });

  it("reports a non-writable database path as a failed check", () => {
    const result = checkDbDirWritable(join(process.cwd(), "package.json"));

    expect(result.status).toBe("fail");
    expect(result.name).toBe("db-dir-writable");
  });

  it("rejects an invalid tool mode", () => {
    process.env["MCP_TOOL_MODE"] = "invalid-mode";

    const result = checkToolMode();

    expect(result.status).toBe("fail");
    expect(result.message).toContain("Invalid MCP_TOOL_MODE");
  });

  it("returns an error result with allPass=false when a key check fails", async () => {
    process.env["MCP_TOOL_MODE"] = "invalid-mode";

    const result = await runDoctor();
    const report = result.data as { allPass: boolean; checks: Array<{ name: string; status: string }> };

    expect(result.status).toBe("error");
    expect(report.allPass).toBe(false);
    expect(report.checks.find((check) => check.name === "tool-mode")?.status).toBe("fail");
  });
});
