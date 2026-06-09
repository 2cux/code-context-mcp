import { execSync } from "node:child_process";

/**
 * Minimal git helpers — all errors are caught and return null.
 * We must never throw from scope resolution.
 */

export interface GitInfo {
  root: string;
  remote: string | null;
  branch: string | null;
}

function exec(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", timeout: 3000 }).trim();
  } catch {
    return null;
  }
}

export function getGitRoot(cwd: string): string | null {
  return exec("git rev-parse --show-toplevel", cwd);
}

export function getGitRemote(cwd: string): string | null {
  return exec("git remote get-url origin", cwd);
}

export function getGitBranch(cwd: string): string | null {
  return exec("git rev-parse --abbrev-ref HEAD", cwd);
}

export function resolveGitInfo(cwd: string): GitInfo | null {
  const root = getGitRoot(cwd);
  if (!root) return null;
  return {
    root,
    remote: getGitRemote(root),
    branch: getGitBranch(root),
  };
}
