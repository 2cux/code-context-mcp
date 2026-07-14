import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMcpConfig } from "../src/cli/doctor.js";
import { getAllowedTools } from "../src/mcp/toolMode.js";

const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

describe("MCP installation documentation", () => {
  it("uses the globally installed server command in the README configs", () => {
    expect(readme).toContain('"command": "code-context-server"');
    expect(readme).toContain('"args": []');
    expect(readme).not.toMatch(/"command": "node"[\s\S]{0,80}dist\/index\.js/);
    expect(readme).toContain("source checkout");
    expect(readme).toContain("node dist/index.js");
  });

  it("returns copyable global-install configs for agent and dev modes", () => {
    const config = buildMcpConfig();

    expect(config.agent).toEqual({
      command: "code-context-server",
      args: [],
      env: { MCP_TOOL_MODE: "agent" },
    });
    expect(config.dev).toEqual({
      command: "code-context-server",
      args: [],
      env: { MCP_TOOL_MODE: "dev" },
    });
  });

  it("keeps agent mode at exactly 7 tools", () => {
    expect(getAllowedTools("agent").size).toBe(7);
  });
});
