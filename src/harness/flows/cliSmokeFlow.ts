/**
 * CLI Smoke Flow
 *
 * Smoke test for all CLI commands:
 *   scope, compress, retrieve, list-compressions,
 *   remember, recall, forget, list-context,
 *   receipt, receipts, profile,
 *   cache stats, cache list, failures list, failures stats
 *
 * Ensures every CLI command spawns, runs, and exits cleanly with
 * captured stdout/stderr and exit code.
 *
 * PRD §34 / §9.7: CLI 验收。
 */

import type { HarnessContext } from "../core/types.js";
import type { CliAdapter } from "../adapters/cliAdapter.js";

// ── Input Types ────────────────────────────────────────────────────────────────

export interface CliSmokeFlowInput {
  adapter: CliAdapter;
}

// ── Output Types ───────────────────────────────────────────────────────────────

export interface CliCommandResult {
  command: string;
  args: string[];
  checkpoint: string;
  exitCode: number;
  hasStdout: boolean;
  hasStderr: boolean;
  passed: boolean;
  error?: string;
}

export interface CliSmokeFlowOutput {
  totalCommands: number;
  passed: number;
  failed: number;
  results: CliCommandResult[];
}

// ── Command Definitions ────────────────────────────────────────────────────────

interface CommandDef {
  checkpoint: string;
  args: string[];
}

const ALL_COMMANDS: CommandDef[] = [
  { checkpoint: "cli:scope", args: ["scope"] },
  { checkpoint: "cli:compress", args: ["compress", "--help"] },
  { checkpoint: "cli:retrieve", args: ["retrieve", "--help"] },
  { checkpoint: "cli:list_compressions", args: ["list-compressions"] },
  { checkpoint: "cli:remember", args: ["remember", "--help"] },
  { checkpoint: "cli:recall", args: ["recall", "--help"] },
  { checkpoint: "cli:forget", args: ["forget", "--help"] },
  { checkpoint: "cli:list_context", args: ["list-context"] },
  { checkpoint: "cli:receipt", args: ["receipt", "--help"] },
  { checkpoint: "cli:receipts", args: ["receipts"] },
  { checkpoint: "cli:profile", args: ["profile"] },
  { checkpoint: "cli:cache_stats", args: ["cache", "stats"] },
  { checkpoint: "cli:cache_list", args: ["cache", "list"] },
  { checkpoint: "cli:failures_list", args: ["failures", "list"] },
  { checkpoint: "cli:failures_stats", args: ["failures", "stats"] },
];

// ── Flow Implementation ────────────────────────────────────────────────────────

export async function cliSmokeFlow(
  ctx: HarnessContext<CliSmokeFlowInput>,
): Promise<CliSmokeFlowOutput> {
  const { adapter } = ctx.input;
  const results: CliCommandResult[] = [];

  // ── Phase 1: spawn_cli_commands ─────────────────────────────────────────────

  ctx.phase("spawn_cli_commands");
  ctx.log(`Spawning all ${ALL_COMMANDS.length} CLI commands...`);

  for (const cmd of ALL_COMMANDS) {
    const label = cmd.args.join(" ");
    ctx.log(`Running: code-context ${label}`);

    try {
      const result = await adapter.run(cmd.args);

      ctx.checkpoint(
        cmd.checkpoint,
        result.exitCode === 0 ? "pass" : "fail",
        `exitCode=${result.exitCode} stdout=${result.stdout.length}B stderr=${result.stderr.length}B`,
      );

      results.push({
        command: "code-context",
        args: cmd.args,
        checkpoint: cmd.checkpoint,
        exitCode: result.exitCode,
        hasStdout: result.stdout.length > 0,
        hasStderr: result.stderr.length > 0,
        passed: result.exitCode === 0,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      ctx.checkpoint(
        cmd.checkpoint,
        "fail",
        `spawn error: ${msg}`,
      );

      results.push({
        command: "code-context",
        args: cmd.args,
        checkpoint: cmd.checkpoint,
        exitCode: -1,
        hasStdout: false,
        hasStderr: false,
        passed: false,
        error: msg,
      });
    }
  }

  // ── Phase 2: capture_stdout ─────────────────────────────────────────────────

  ctx.phase("capture_stdout");

  const stdoutCount = results.filter((r) => r.hasStdout).length;
  ctx.log(`Commands with stdout: ${stdoutCount}/${ALL_COMMANDS.length}`);

  // ── Phase 3: capture_stderr ─────────────────────────────────────────────────

  ctx.phase("capture_stderr");

  const stderrCount = results.filter((r) => r.hasStderr).length;
  ctx.log(`Commands with stderr: ${stderrCount}/${ALL_COMMANDS.length}`);

  // ── Phase 4: verify_exit_code ────────────────────────────────────────────────

  ctx.phase("verify_exit_code");

  const exitCodePassed = results.filter((r) => r.exitCode === 0).length;
  const exitCodeFailed = results.filter((r) => r.exitCode !== 0).length;
  ctx.log(`Exit code: ${exitCodePassed} passed, ${exitCodeFailed} non-zero`);

  // ── Phase 5: write_cli_report ───────────────────────────────────────────────

  ctx.phase("write_cli_report");

  const totalCommands = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  const output: CliSmokeFlowOutput = {
    totalCommands,
    passed,
    failed,
    results,
  };

  ctx.writeArtifact(
    "cli-smoke-results",
    JSON.stringify(results, null, 2),
    "application/json",
  );
  ctx.writeArtifact(
    "cli-report",
    JSON.stringify(output, null, 2),
    "application/json",
  );

  ctx.log(`CLI smoke complete: ${passed}/${totalCommands} passed, ${failed} failed`);
  return output;
}
