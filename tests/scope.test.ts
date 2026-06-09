import { describe, it, expect } from "vitest";
import { resolveScope } from "../src/scope/resolveScope.js";

describe("resolveScope", () => {
  it("returns a scopeId for the current directory", () => {
    const scope = resolveScope();
    expect(scope).toBeDefined();
    expect(scope.scopeId).toBeTruthy();
    expect(scope.scopeId).toMatch(/^(repo_|cwd_)/);
    expect(scope.cwd).toBeTruthy();
    expect(scope.scopeStrategy).toMatch(
      /^(gitRemote\+gitRoot|gitRootOnly|cwdFallback)$/,
    );
  });

  it("returns the same scopeId for the same cwd", () => {
    const a = resolveScope(process.cwd());
    const b = resolveScope(process.cwd());
    expect(a.scopeId).toBe(b.scopeId);
    expect(a.scopeStrategy).toBe(b.scopeStrategy);
  });

  it("returns different scopeId for different cwds", () => {
    const a = resolveScope("/tmp/project-a");
    const b = resolveScope("/tmp/project-b");
    expect(a.scopeId).not.toBe(b.scopeId);
  });

  it("falls back to cwdFallback for a non-existent non-git path", () => {
    const scope = resolveScope("/tmp/nonexistent-dir-12345");
    expect(scope.scopeStrategy).toBe("cwdFallback");
    expect(scope.scopeId).toMatch(/^cwd_/);
    expect(scope.gitRoot).toBeNull();
  });
});
