/**
 * CLI Smoke Manifest
 *
 * Declares the CLI smoke test: every CLI command must run without crashing.
 *
 * PRD §34: CLI 验收 Manifest。
 */

import type { Manifest } from "../core/types.js";

export const cliSmokeFlowManifest: Manifest = {
  name: "cliSmokeFlow",
  description: "Smoke test for all CLI commands — every command must run without crashing",
  loopType: "cliSmoke",
  tags: ["cli", "smoke", "closed-loop"],
  steps: [
    { name: "scope", description: "Run 'code-context scope' command", expect: "success" },
    { name: "compress", description: "Run 'code-context compress' command", expect: "success" },
    { name: "retrieve", description: "Run 'code-context retrieve' command", expect: "success" },
    { name: "list_compressions", description: "Run 'code-context list-compressions' command", expect: "success" },
    { name: "stats", description: "Run 'code-context stats' command", expect: "success" },
    { name: "remember", description: "Run 'code-context remember' command", expect: "success" },
    { name: "recall", description: "Run 'code-context recall' command", expect: "success" },
    { name: "forget", description: "Run 'code-context forget' command", expect: "success" },
    { name: "list_context", description: "Run 'code-context list-context' command", expect: "success" },
    { name: "profile", description: "Run 'code-context profile' command", expect: "success" },
    { name: "receipts", description: "Run 'code-context receipts' command", expect: "success" },
    { name: "cache_stats", description: "Run 'code-context cache stats' command", expect: "success" },
    { name: "failures_list", description: "Run 'code-context failures list' command", expect: "success" },
    { name: "cleanup", description: "Run 'code-context cleanup' command", expect: "success" },
  ],
};
