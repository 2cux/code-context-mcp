/**
 * CLI Adapter
 *
 * Provides a programmatic interface for executing CLI commands and
 * capturing their stdout, stderr, and exit codes. Used by the CLI
 * smoke flow to verify command health.
 *
 * PRD §34: CLI 验收适配器。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CliAdapter {
  /** Execute a code-context CLI command with the given arguments. */
  run(args: string[]): Promise<CliResult>;
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface CliAdapterOptions {
  /** Path to the CLI entry point (default: "node dist/cli/index.js"). */
  cliPath?: string;
  /** Timeout in milliseconds (default: 30_000). */
  timeout?: number;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/** Create a CLI adapter backed by the real CLI executable. */
export function createCliAdapter(opts: CliAdapterOptions = {}): CliAdapter {
  const cliPath = opts.cliPath ?? "node dist/cli/index.js";
  const timeout = opts.timeout ?? 30_000;

  // Normalize: strip optional "node " / "node.exe " prefix (case-insensitive).
  const scriptPath = cliPath.replace(/^node(?:\.exe)?\s+/i, "");
  // Use process.execPath for reliable Node resolution on all platforms.
  const nodePath = process.execPath;

  return {
    async run(args: string[]): Promise<CliResult> {
      try {
        const { stdout, stderr } = await execFileAsync(nodePath, [scriptPath, ...args], {
          timeout,
          windowsHide: true,
        });
        return { stdout, stderr, exitCode: 0 };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; code?: number };
        return {
          stdout: e.stdout ?? "",
          stderr: e.stderr ?? "",
          exitCode: e.code ?? 1,
        };
      }
    },
  };
}
