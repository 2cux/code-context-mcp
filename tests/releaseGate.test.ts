import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("traceable clean release gate", () => {
  it("rejects a dirty working tree before creating a release worktree", () => {
    const fixture = mkdtempSync(join(tmpdir(), "code-context-release-gate-test-"));
    const scriptDir = join(fixture, "scripts", "release");
    mkdirSync(scriptDir, { recursive: true });
    cpSync(
      join(root, "scripts", "release", "clean-release-gate.mjs"),
      join(scriptDir, "clean-release-gate.mjs"),
    );

    execFileSync("git", ["init", "-q"], { cwd: fixture });
    execFileSync("git", ["config", "user.name", "release-gate-test"], { cwd: fixture });
    execFileSync("git", ["config", "user.email", "release-gate@example.invalid"], { cwd: fixture });
    execFileSync("git", ["add", "."], { cwd: fixture });
    execFileSync("git", ["commit", "-q", "-m", "fixture"], { cwd: fixture });
    writeFileSync(join(fixture, "dirty.txt"), "must block release\n", "utf-8");

    const result = spawnSync("node", [join(scriptDir, "clean-release-gate.mjs")], {
      cwd: fixture,
      encoding: "utf-8",
    });
    expect(result.status).toBe(1);
    const reportPath = result.stdout.trim().match(/^FAIL: (.+release-gate\.json)$/m)?.[1];
    expect(reportPath).toBeTruthy();
    const report = JSON.parse(readFileSync(reportPath!, "utf-8"));
    expect(report).toMatchObject({
      verdict: "FAIL",
      gitDirty: true,
      finalGitDirty: true,
      tgzSha256: null,
      packageFileCount: null,
      sameCommitAndTgz: false,
    });
    expect(report.error).toContain("requires a clean working tree");
    expect(report.steps.find((step: { name: string }) =>
      step.name === "Require clean caller working tree")).toMatchObject({ status: "FAIL" });
    expect(report.steps.some((step: { name: string }) =>
      step.name === "Create detached temporary release worktree")).toBe(false);
  });

  it("wires the final tgz identity through stable gate and fresh-install smoke", () => {
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    const gate = readFileSync(join(root, "scripts", "release", "clean-release-gate.mjs"), "utf-8");
    const stable = readFileSync(join(root, "scripts", "release", "stable-readiness-check.mjs"), "utf-8");
    const smoke = readFileSync(join(root, "scripts", "release", "clean-install-smoke.mjs"), "utf-8");

    expect(packageJson.scripts["release:gate"]).toBe("node scripts/release/clean-release-gate.mjs");
    for (const field of ["gitCommit", "gitDirty", "tgzSha256", "packageFileCount", "generatedAt"]) {
      expect(gate).toContain(field);
      expect(stable).toContain(field);
      expect(smoke).toContain(field);
    }
    expect(gate).toContain("CODECONTEXT_RELEASE_TGZ_SHA256");
    expect(stable).toContain("CODECONTEXT_RELEASE_TGZ_SHA256");
    expect(smoke).toContain("CODECONTEXT_RELEASE_TGZ_SHA256");
    expect(gate).toContain("sameCommitAndTgz");
    expect(gate).not.toMatch(/execFileSync\([^\n]*(?:npm publish|git tag)/);
  });
});
