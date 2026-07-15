import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = process.cwd();
const cliPath = join(root, "dist", "cli", "index.js");
const nonGitDir = mkdtempSync(join(tmpdir(), "code-context-non-git-"));
const homeDir = mkdtempSync(join(tmpdir(), "code-context-non-git-home-"));

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(command: string): CliRun {
  const result = spawnSync(process.execPath, [cliPath, command, "--json"], {
    cwd: nonGitDir,
    encoding: "utf-8",
    timeout: 60_000,
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) throw result.error;

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("CLI in a non-Git directory", () => {
  beforeAll(() => {
    execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc")], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    execFileSync(process.execPath, [join(root, "scripts", "copy-schema.mjs")], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }, 30_000);

  afterAll(() => {
    rmSync(nonGitDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("generates a fallback project scope without Git fatal output", () => {
    const result = runCli("scope");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toMatch(/fatal:.*not a git repository/i);

    const scope = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(scope.scopeId).toMatch(/^cwd_/);
    expect(scope.scopeStrategy).toBe("cwdFallback");
    expect(scope.gitRoot).toBeNull();
    expect(scope.remote).toBeNull();
    expect(scope.branch).toBeNull();
  });

  for (const command of ["doctor", "demo", "value"] as const) {
    it(`${command} --json exits successfully with pure JSON stdout and no Git fatal`, () => {
      const result = runCli(command);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).not.toMatch(/fatal:.*not a git repository/i);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
      expect(result.stdout.trim()).toBe(JSON.stringify(JSON.parse(result.stdout)));
    });
  }
});
