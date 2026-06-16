/**
 * CLI Smoke Manifest
 *
 * Declares the CLI smoke test: every CLI command must spawn, run, and
 * exit cleanly with captured stdout/stderr and exit code.
 *
 * PRD §34 / §9.7: CLI 验收 Manifest。
 */

import type { HarnessManifest } from "../core/types.js";

export const cliSmokeFlowManifest: HarnessManifest = {
  id: "cli-smoke-flow",
  name: "CLI Smoke Flow",
  description:
    "Smoke test for all CLI commands — every command must spawn, run, " +
    "and exit cleanly with captured stdout/stderr and exit code",
  phases: [
    { name: "spawn_cli_commands", description: "Spawn each CLI command via the CLI adapter" },
    { name: "capture_stdout", description: "Capture and validate stdout for each command" },
    { name: "capture_stderr", description: "Capture and validate stderr for each command" },
    { name: "verify_exit_code", description: "Verify exit code for each command" },
    { name: "write_cli_report", description: "Write per-command pass/fail report artifact" },
  ],
  checkpoints: [
    { name: "cli:scope", description: "Run 'scope' command", expect: "pass" },
    { name: "cli:compress", description: "Run 'compress' command", expect: "pass" },
    { name: "cli:retrieve", description: "Run 'retrieve' command", expect: "pass" },
    { name: "cli:list_compressions", description: "Run 'list-compressions' command", expect: "pass" },
    { name: "cli:remember", description: "Run 'remember' command", expect: "pass" },
    { name: "cli:recall", description: "Run 'recall' command", expect: "pass" },
    { name: "cli:forget", description: "Run 'forget' command", expect: "pass" },
    { name: "cli:list_context", description: "Run 'list-context' command", expect: "pass" },
    { name: "cli:receipt", description: "Run 'receipt' command", expect: "pass" },
    { name: "cli:receipts", description: "Run 'receipts' command", expect: "pass" },
    { name: "cli:profile", description: "Run 'profile' command", expect: "pass" },
    { name: "cli:cache_stats", description: "Run 'cache stats' command", expect: "pass" },
    { name: "cli:cache_list", description: "Run 'cache list' command", expect: "pass" },
    { name: "cli:failures_list", description: "Run 'failures list' command", expect: "pass" },
    { name: "cli:failures_stats", description: "Run 'failures stats' command", expect: "pass" },
  ],
  artifacts: [
    { name: "cli-smoke-results", description: "Per-command smoke test results", contentType: "application/json" },
    { name: "cli-report", description: "Aggregate CLI smoke report", contentType: "application/json" },
  ],
  coversTools: [],
  tags: ["smoke", "cli", "acceptance"],
  capability: "smoke-test",
};
