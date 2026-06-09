import { resolveGitInfo } from "./git.js";
import { shortHash } from "../utils/hash.js";
import { nowISO } from "../utils/time.js";

export interface ScopeResult {
  scopeId: string;
  gitRoot: string | null;
  remote: string | null;
  branch: string | null;
  cwd: string;
  scopeStrategy: "gitRemote+gitRoot" | "gitRootOnly" | "cwdFallback";
}

/**
 * Resolve the current project scope.
 *
 * Strategy (in priority order):
 *   1. hash(gitRemote + gitRoot)  — most stable, survives repo moves
 *   2. hash(gitRoot)              — fallback when no remote
 *   3. hash(cwd)                  — last resort for non-git directories
 *
 * This function MUST NOT throw — scope resolution is a fundamental
 * operation and must always return a usable scopeId.
 */
export function resolveScope(cwd?: string): ScopeResult {
  const dir = cwd ?? process.cwd();
  const git = resolveGitInfo(dir);

  if (git && git.remote) {
    return {
      scopeId: `repo_${shortHash(git.remote + git.root)}`,
      gitRoot: git.root,
      remote: git.remote,
      branch: git.branch,
      cwd: dir,
      scopeStrategy: "gitRemote+gitRoot",
    };
  }

  if (git) {
    return {
      scopeId: `repo_${shortHash(git.root)}`,
      gitRoot: git.root,
      remote: null,
      branch: git.branch,
      cwd: dir,
      scopeStrategy: "gitRootOnly",
    };
  }

  return {
    scopeId: `cwd_${shortHash(dir)}`,
    gitRoot: null,
    remote: null,
    branch: null,
    cwd: dir,
    scopeStrategy: "cwdFallback",
  };
}

/**
 * Returns a timestamped ScopeRecord suitable for persisting to the scopes table.
 */
export function toScopeRecord(scope: ScopeResult) {
  const now = nowISO();
  return {
    scope_id: scope.scopeId,
    git_root: scope.gitRoot,
    remote: scope.remote,
    branch: scope.branch,
    cwd: scope.cwd,
    scope_strategy: scope.scopeStrategy,
    created_at: now,
    updated_at: now,
  };
}
