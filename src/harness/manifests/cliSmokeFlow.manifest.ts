/**
 * CLI Smoke Manifest
 *
 * Declares the CLI smoke test: every CLI command must run without crashing.
 *
 * PRD §34: CLI 验收 Manifest。
 */

import type { HarnessManifest } from "../core/types.js";

export const cliSmokeFlowManifest: HarnessManifest = {
  id: "cli-smoke-flow",
  name: "CLI Smoke Flow",
  description:
    "Smoke test for all CLI commands — every command must run without crashing",
  phases: [
    { name: "compression_cmds", description: "Smoke test compression CLI commands" },
    { name: "memory_cmds", description: "Smoke test memory CLI commands" },
    { name: "utility_cmds", description: "Smoke test utility CLI commands" },
  ],
  checkpoints: [
    { name: "cli:scope", description: "Run 'code-context scope' command", expect: "pass" },
    { name: "cli:compress", description: "Run 'code-context compress' command", expect: "pass" },
    { name: "cli:retrieve", description: "Run 'code-context retrieve' command", expect: "pass" },
    { name: "cli:list_compressions", description: "Run 'code-context list-compressions' command", expect: "pass" },
    { name: "cli:stats", description: "Run 'code-context stats' command", expect: "pass" },
    { name: "cli:remember", description: "Run 'code-context remember' command", expect: "pass" },
    { name: "cli:recall", description: "Run 'code-context recall' command", expect: "pass" },
    { name: "cli:forget", description: "Run 'code-context forget' command", expect: "pass" },
    { name: "cli:list_context", description: "Run 'code-context list-context' command", expect: "pass" },
    { name: "cli:profile", description: "Run 'code-context profile' command", expect: "pass" },
    { name: "cli:receipts", description: "Run 'code-context receipts' command", expect: "pass" },
    { name: "cli:cache_stats", description: "Run 'code-context cache stats' command", expect: "pass" },
    { name: "cli:failures_list", description: "Run 'code-context failures list' command", expect: "pass" },
    { name: "cli:cleanup", description: "Run 'code-context cleanup' command", expect: "pass" },
  ],
  artifacts: [
    { name: "cli-smoke-results", description: "Per-command smoke test results", contentType: "application/json" },
  ],
  coversTools: [],
};
