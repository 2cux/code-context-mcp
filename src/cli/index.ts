#!/usr/bin/env node

/**
 * CodeContext MCP — CLI
 *
 * Usage:
 *   code-context scope                   Show current repo scope
 *   code-context stats                   Show token/stats summary
 *   code-context receipt <id>            Show a receipt by ID
 *   code-context compress <file>         Compress file content
 *   code-context retrieve <ref>          Retrieve original content
 *   code-context list-compressions       List compressed context records
 *   code-context cleanup                 Clean up expired originals
 *
 * Global flags:
 *   --help, -h      Show help
 *   --version, -v   Show version
 *   --json          Output compact JSON (default: pretty-printed)
 */

import {
  runScope,
  runStats,
  runListCompressions,
  runReceipt,
  runCompress,
  runRetrieve,
  runCleanup,
  runRemember,
  runForget,
  runRecall,
  runListContext,
  runProfile,
  runCacheStats,
  runCacheClear,
  runCacheList,
  runReceipts,
  runFailuresList,
  runFailuresStats,
} from "./commands.js";
import type { CliResult } from "./commands.js";

import {
  runHarnessList,
  runHarnessRun,
  runHarnessCheck,
  runHarnessRuns,
  runHarnessShow,
  runHarnessLogs,
  runHarnessArtifacts,
  formatHumanReadable,
} from "./harnessCommands.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VERSION = "1.0.0";

const HELP_TEXT = `CodeContext MCP CLI v${VERSION}

Usage:
  code-context <command> [options]

Commands:
  scope [cwd]                          Show current repo scope
  stats                                Show token and operation stats
  receipt <receiptId>                  Show a receipt by ID
  compress <file>                      Compress file content
      --type <contentType>             Content type hint
      --strategy conservative|auto    Compression strategy (default: conservative)
      --no-keep-original               Don't save original content
      --max-tokens <n>                 Max output tokens (default: 2000)
      --timeout <ms>                   Timeout in ms (default: 5000)
  retrieve <originalRef>               Retrieve original content
      --offset <n>                     Character offset (default: 0)
      --limit <n>                      Max chars to return (default: 10000)
  list-compressions                    List compressed context records
      --type <contentType>             Filter by content type
      --limit <n>                      Max records (default: 20)
      --offset <n>                     Pagination offset
  cleanup --originals                  Clean up expired originals
  remember                              Save a project memory
      --type <memoryType>               Memory type (required)
      --content <text>                  Memory content
      --file <path>                     Read content from file
      --summary <text>                  Short summary
      --source-ref <text>               Source reference
      --confidence <number>             Confidence 0–1 (default: 0.8)
      --profile-target static|dynamic   Profile target layer
      --expires-at <ISO>                Expiration date
      --tags <tag1,tag2,...>            Comma-separated tags
  recall <query>                        Search project memory
      --type <memoryType>               Filter by memory type
      --status <memoryStatus>           Filter by status
      --limit <n>                       Max results (default: 10)
      --profile                         Include repo profile
      --no-related-ccrs                 Exclude related compressed contexts
  list-context                          List project memories
      --type <memoryType>               Filter by memory type
      --status <memoryStatus>           Filter by status
      --limit <n>                       Max records (default: 20)
      --offset <n>                      Pagination offset
      --sort-by <field>                 Sort field (createdAt, updatedAt, type, status, confidence)
      --sort-order <asc|desc>          Sort order (default: desc)
  forget <memoryId>                     Forget a project memory
      --mode soft_forget|supersede|expire|hard_delete
                                        Forget mode (required)
      --reason <text>                   Reason for forgetting
      --by <id>                         Replacement memory id (supersede only)
      --superseded-by <id>              Alias for --by
  profile                               Show repo profile (both layers)
      --static                          Show static profile only
      --dynamic                         Show dynamic context only
      --all                             Include expired facts
      --limit <n>                       Max records (default: 20)
      --offset <n>                      Pagination offset
  receipts                              List all operation receipts
      --operation <operation>           Filter by operation type
      --limit <n>                       Max records (default: 20)
      --offset <n>                      Pagination offset
  cache stats                           Show cache statistics
  cache clear                           Clear all cached compression entries
  cache list                            List cache entries
      --limit <n>                       Max records (default: 20)
      --offset <n>                      Pagination offset
  failures list                         List failure events (§33)
      --event-type <type>               Filter by event type
      --operation <op>                  Filter by operation
      --limit <n>                       Max records (default: 20)
      --offset <n>                      Pagination offset
  failures stats                        Show failure event statistics
  harness list                          List all registered harness flows
  harness run <flow-id>                 Execute a harness flow
      --input <file>                     Input JSON file for the flow
  harness check <flow-id>               Validate a flow manifest
  harness runs                          List past harness runs
  harness show <run-id>                 Show run details
  harness logs <run-id>                 Show run event logs
  harness artifacts <run-id>            List run artifacts
      --name <artifact-name>             Read a specific artifact

Global flags:
  --help, -h                           Show this help
  --version, -v                        Show version
  --json                               Output compact JSON

Examples:
  code-context scope
  code-context compress ./test-output.log --type test_output
  code-context retrieve orig_abc123
  code-context list-compressions --type test_output --limit 10
  code-context receipt rcp_abc123
  code-context stats --json
  code-context cleanup --originals
  code-context remember --type project_rule --content "Use pnpm" --profile-target static
  code-context remember --type current_task --file ./task.md --profile-target dynamic
  code-context recall "package manager" --type project_rule --profile
  code-context list-context --type project_rule --status active --sort-by confidence
  code-context forget mem_01HXYZ --mode soft_forget --reason "No longer relevant"
  code-context forget mem_01HXYZ --mode supersede --by mem_02NEW
  code-context profile --static
  code-context profile --dynamic --all
  code-context receipts --operation remember --limit 10
  code-context failures list --event-type compression_timeout --limit 10
  code-context failures list --operation recall
  code-context failures stats`;

// ---------------------------------------------------------------------------
// Arg parsing helpers
// ---------------------------------------------------------------------------

/** Split args into (global flags, command name, command args). */
function parseArgs(
  raw: string[],
): { help: boolean; version: boolean; compactJson: boolean; command: string; cmdArgs: string[] } {
  let help = false;
  let version = false;
  let compactJson = false;
  const remaining: string[] = [];

  for (const arg of raw) {
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--version" || arg === "-v") {
      version = true;
    } else if (arg === "--json") {
      compactJson = true;
    } else {
      remaining.push(arg);
    }
  }

  const command = remaining[0] ?? "";
  const cmdArgs = remaining.slice(1);

  return { help, version, compactJson, command, cmdArgs };
}

/** Get a named option value: --key value or --key=value. Returns undefined if not found. */
function getOpt(args: string[], key: string): string | undefined {
  const flag = `--${key}`;
  const eqPrefix = `--${key}=`;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === flag && i + 1 < args.length) {
      const next = args[i + 1]!;
      // Don't consume the next arg if it looks like another flag
      if (next.startsWith("--")) return undefined;
      return next;
    }
    if (arg.startsWith(eqPrefix)) {
      return arg.slice(eqPrefix.length);
    }
  }
  return undefined;
}

/** Check if a boolean flag is present (e.g. --no-keep-original). */
function hasFlag(args: string[], flag: string): boolean {
  return args.includes(`--${flag}`);
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function outputResult(result: CliResult, compactJson: boolean): void {
  const indent = compactJson ? 0 : 2;
  console.log(JSON.stringify(result.data, null, indent));
}

function outputError(message: string): void {
  console.error(JSON.stringify({ error: message }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const { help, version, compactJson, command, cmdArgs } = parseArgs(rawArgs);

  // --help / --version take priority
  if (help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (version) {
    console.log(VERSION);
    process.exit(0);
  }

  let result: CliResult;

  switch (command) {
    // ------------------------------------------------------------------
    // scope
    // ------------------------------------------------------------------
    case "scope": {
      const cwd = cmdArgs[0];
      result = runScope(cwd || undefined);
      break;
    }

    // ------------------------------------------------------------------
    // stats
    // ------------------------------------------------------------------
    case "stats": {
      result = await runStats();
      break;
    }

    // ------------------------------------------------------------------
    // list-compressions
    // ------------------------------------------------------------------
    case "list-compressions": {
      const typeStr = getOpt(cmdArgs, "type");
      const limitStr = getOpt(cmdArgs, "limit");
      const offsetStr = getOpt(cmdArgs, "offset");

      const limit = limitStr ? parseInt(limitStr, 10) : undefined;
      const offset = offsetStr ? parseInt(offsetStr, 10) : undefined;

      result = await runListCompressions({
        type: typeStr,
        limit: limit && !Number.isNaN(limit) ? Math.max(1, Math.min(limit, 100)) : undefined,
        offset: offset && !Number.isNaN(offset) ? Math.max(0, offset) : undefined,
      });
      break;
    }

    // ------------------------------------------------------------------
    // receipt
    // ------------------------------------------------------------------
    case "receipt": {
      const receiptId = cmdArgs[0];
      if (!receiptId) {
        outputError("Usage: code-context receipt <receiptId>");
        process.exit(1);
      }
      result = await runReceipt(receiptId);
      break;
    }

    // ------------------------------------------------------------------
    // compress
    // ------------------------------------------------------------------
    case "compress": {
      const filePath = cmdArgs[0];
      if (!filePath) {
        outputError("Usage: code-context compress <file> [options]");
        process.exit(1);
      }

      const typeStr = getOpt(cmdArgs, "type");
      const strategy = getOpt(cmdArgs, "strategy");
      const maxTokensStr = getOpt(cmdArgs, "max-tokens");
      const timeoutStr = getOpt(cmdArgs, "timeout");
      const noKeepOriginal = hasFlag(cmdArgs, "no-keep-original");

      const maxTokens = maxTokensStr ? parseInt(maxTokensStr, 10) : undefined;
      const timeoutMs = timeoutStr ? parseInt(timeoutStr, 10) : undefined;

      result = await runCompress(filePath, {
        type: typeStr,
        strategy: strategy ?? "conservative",
        keepOriginal: !noKeepOriginal,
        maxTokens: maxTokens && !Number.isNaN(maxTokens) ? maxTokens : undefined,
        timeoutMs: timeoutMs && !Number.isNaN(timeoutMs) ? timeoutMs : undefined,
      });
      break;
    }

    // ------------------------------------------------------------------
    // retrieve
    // ------------------------------------------------------------------
    case "retrieve": {
      const originalRef = cmdArgs[0];
      if (!originalRef) {
        outputError("Usage: code-context retrieve <originalRef> [options]");
        process.exit(1);
      }

      const offsetStr = getOpt(cmdArgs, "offset");
      const limitStr = getOpt(cmdArgs, "limit");

      const offset = offsetStr ? parseInt(offsetStr, 10) : undefined;
      const limit = limitStr ? parseInt(limitStr, 10) : undefined;

      result = await runRetrieve(originalRef, {
        offset: offset && !Number.isNaN(offset) ? Math.max(0, offset) : undefined,
        limit: limit && !Number.isNaN(limit) ? limit : undefined,
      });
      break;
    }

    // ------------------------------------------------------------------
    // cleanup
    // ------------------------------------------------------------------
    case "cleanup": {
      if (!hasFlag(cmdArgs, "originals")) {
        outputError(
          'Usage: code-context cleanup --originals\n' +
            '  --originals  Clean up expired original content records.',
        );
        process.exit(1);
      }
      result = await runCleanup();
      break;
    }

    // ------------------------------------------------------------------
    // remember
    // ------------------------------------------------------------------
    case "remember": {
      const typeStr = getOpt(cmdArgs, "type");
      if (!typeStr) {
        outputError(
          'Usage: code-context remember --type <type> [--content <text> | --file <path>]\n' +
            '  --type <type>            Memory type (required): decision, bug, command,\n' +
            '                           file_summary, project_rule, user_preference,\n' +
            '                           current_task, test_failure, api_contract, dependency.\n' +
            '  --content <text>         Memory content as a string.\n' +
            '  --file <path>            Read content from a file.\n' +
            '  --summary <text>         Optional short summary.\n' +
            '  --source-ref <text>      Optional source reference.\n' +
            '  --confidence <number>    Confidence 0–1 (default 0.8).\n' +
            '  --profile-target <t>     "static" or "dynamic".\n' +
            '  --expires-at <ISO>       Expiration date (ISO 8601).\n' +
            '  --tags <tag1,tag2,...>   Comma-separated tags.',
        );
        process.exit(1);
      }

      const contentStr = getOpt(cmdArgs, "content");
      const fileStr = getOpt(cmdArgs, "file");
      const summaryStr = getOpt(cmdArgs, "summary");
      const sourceRefStr = getOpt(cmdArgs, "source-ref");
      const confidenceStr = getOpt(cmdArgs, "confidence");
      const profileTargetStr = getOpt(cmdArgs, "profile-target");
      const expiresAtStr = getOpt(cmdArgs, "expires-at");
      const tagsStr = getOpt(cmdArgs, "tags");

      const confidence = confidenceStr !== undefined ? parseFloat(confidenceStr) : undefined;
      const tags = tagsStr
        ? tagsStr.split(",").map((t) => t.trim()).filter((t) => t.length > 0)
        : undefined;

      result = await runRemember({
        type: typeStr,
        content: contentStr,
        file: fileStr,
        summary: summaryStr,
        sourceRef: sourceRefStr,
        confidence: confidence !== undefined && !Number.isNaN(confidence) ? confidence : undefined,
        profileTarget: profileTargetStr,
        expiresAt: expiresAtStr,
        tags,
      });
      break;
    }

    // ------------------------------------------------------------------
    // forget
    // ------------------------------------------------------------------
    case "forget": {
      const idStr = cmdArgs[0];
      if (!idStr) {
        outputError(
          'Usage: code-context forget <memoryId> [options]\n' +
            '  --mode <mode>            Forget mode (required): soft_forget, supersede,\n' +
            '                           expire, hard_delete.\n' +
            '  --reason <text>          Optional reason for forgetting.\n' +
            '  --by <id>                Required when mode is supersede.\n' +
            '                           Id of the memory that replaces this one.\n' +
            '  --superseded-by <id>     Alias for --by.',
        );
        process.exit(1);
      }

      const modeStr = getOpt(cmdArgs, "mode");
      if (!modeStr) {
        outputError(
          'Usage: code-context forget <memoryId> --mode <mode>\n' +
            '  --mode is required. Valid modes: soft_forget, supersede, expire, hard_delete.',
        );
        process.exit(1);
      }

      const reasonStr = getOpt(cmdArgs, "reason");
      const supersededByStr = getOpt(cmdArgs, "by") ?? getOpt(cmdArgs, "superseded-by");

      result = await runForget({
        id: idStr,
        mode: modeStr,
        reason: reasonStr,
        supersededBy: supersededByStr,
      });
      break;
    }

    // ------------------------------------------------------------------
    // recall
    // ------------------------------------------------------------------
    case "recall": {
      const query = cmdArgs[0];
      if (!query) {
        outputError(
          'Usage: code-context recall <query> [options]\n' +
            '  --type <memoryType>       Filter by memory type.\n' +
            '  --status <memoryStatus>   Filter by status.\n' +
            '  --limit <n>               Max results (default: 10).\n' +
            '  --profile                 Include repo profile.\n' +
            '  --no-related-ccrs         Exclude related compressed contexts.',
        );
        process.exit(1);
      }

      const typeStr = getOpt(cmdArgs, "type");
      const statusStr = getOpt(cmdArgs, "status");
      const limitStr = getOpt(cmdArgs, "limit");
      const includeProfile = hasFlag(cmdArgs, "profile");
      const noRelatedCcrs = hasFlag(cmdArgs, "no-related-ccrs");

      const types = typeStr
        ? typeStr.split(",").map((t) => t.trim()).filter((t) => t.length > 0)
        : undefined;
      const statuses = statusStr
        ? statusStr.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
        : undefined;
      const limit = limitStr ? parseInt(limitStr, 10) : undefined;

      result = await runRecall(query, {
        types,
        status: statuses,
        limit: limit && !Number.isNaN(limit) ? Math.max(1, Math.min(limit, 100)) : undefined,
        includeProfile,
        includeRelatedCCRs: !noRelatedCcrs,
      });
      break;
    }

    // ------------------------------------------------------------------
    // list-context
    // ------------------------------------------------------------------
    case "list-context": {
      const typeStr = getOpt(cmdArgs, "type");
      const statusStr = getOpt(cmdArgs, "status");
      const limitStr = getOpt(cmdArgs, "limit");
      const offsetStr = getOpt(cmdArgs, "offset");
      const sortByStr = getOpt(cmdArgs, "sort-by");
      const sortOrderStr = getOpt(cmdArgs, "sort-order");

      const types = typeStr
        ? typeStr.split(",").map((t) => t.trim()).filter((t) => t.length > 0)
        : undefined;
      const statuses = statusStr
        ? statusStr.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
        : undefined;
      const limit = limitStr ? parseInt(limitStr, 10) : undefined;
      const offset = offsetStr ? parseInt(offsetStr, 10) : undefined;

      result = await runListContext({
        types,
        status: statuses,
        limit: limit && !Number.isNaN(limit) ? Math.max(1, Math.min(limit, 100)) : undefined,
        offset: offset && !Number.isNaN(offset) ? Math.max(0, offset) : undefined,
        sortBy: sortByStr,
        sortOrder: sortOrderStr,
      });
      break;
    }

    // ------------------------------------------------------------------
    // profile
    // ------------------------------------------------------------------
    case "profile": {
      const staticFlag = hasFlag(cmdArgs, "static");
      const dynamicFlag = hasFlag(cmdArgs, "dynamic");
      const allFlag = hasFlag(cmdArgs, "all");
      const limitStr = getOpt(cmdArgs, "limit");
      const offsetStr = getOpt(cmdArgs, "offset");

      const limit = limitStr ? parseInt(limitStr, 10) : undefined;
      const offset = offsetStr ? parseInt(offsetStr, 10) : undefined;

      const layer = staticFlag ? "static" : dynamicFlag ? "dynamic" : undefined;

      result = await runProfile({
        layer,
        activeOnly: !allFlag,
        limit: limit && !Number.isNaN(limit) ? Math.max(1, Math.min(limit, 100)) : undefined,
        offset: offset && !Number.isNaN(offset) ? Math.max(0, offset) : undefined,
      });
      break;
    }

    // ------------------------------------------------------------------
    // receipts
    // ------------------------------------------------------------------
    case "receipts": {
      const operationStr = getOpt(cmdArgs, "operation");
      const limitStr = getOpt(cmdArgs, "limit");
      const offsetStr = getOpt(cmdArgs, "offset");

      const limit = limitStr ? parseInt(limitStr, 10) : undefined;
      const offset = offsetStr ? parseInt(offsetStr, 10) : undefined;

      result = await runReceipts({
        operation: operationStr,
        limit: limit && !Number.isNaN(limit) ? Math.max(1, Math.min(limit, 100)) : undefined,
        offset: offset && !Number.isNaN(offset) ? Math.max(0, offset) : undefined,
      });
      break;
    }

    // ------------------------------------------------------------------
    // cache
    // ------------------------------------------------------------------
    case "cache": {
      const cacheSub = cmdArgs[0];
      const cacheRest = cmdArgs.slice(1);

      switch (cacheSub) {
        case "stats": {
          result = await runCacheStats();
          break;
        }
        case "clear": {
          result = await runCacheClear();
          break;
        }
        case "list": {
          const limitStr = getOpt(cacheRest, "limit");
          const offsetStr = getOpt(cacheRest, "offset");

          const limit = limitStr ? parseInt(limitStr, 10) : undefined;
          const offset = offsetStr ? parseInt(offsetStr, 10) : undefined;

          result = await runCacheList({
            limit: limit && !Number.isNaN(limit) ? Math.max(1, Math.min(limit, 100)) : undefined,
            offset: offset && !Number.isNaN(offset) ? Math.max(0, offset) : undefined,
          });
          break;
        }
        default: {
          if (cacheSub) {
            outputError(
              `Unknown cache subcommand: ${cacheSub}\n` +
                `Available: stats, clear, list\n` +
                `Run "code-context --help" for usage.`,
            );
          } else {
            outputError(
              `Usage: code-context cache <subcommand>\n` +
                `  stats   Show cache statistics\n` +
                `  clear   Clear all cached compression entries\n` +
                `  list    List cache entries\n` +
                `Run "code-context --help" for usage.`,
            );
          }
          process.exit(1);
        }
      }
      break;
    }

    // ------------------------------------------------------------------
    // failures
    // ------------------------------------------------------------------
    case "failures": {
      const failSub = cmdArgs[0];
      const failRest = cmdArgs.slice(1);

      switch (failSub) {
        case "list": {
          const eventTypeStr = getOpt(failRest, "event-type");
          const operationStr = getOpt(failRest, "operation");
          const limitStr = getOpt(failRest, "limit");
          const offsetStr = getOpt(failRest, "offset");

          const limit = limitStr ? parseInt(limitStr, 10) : undefined;
          const offset = offsetStr ? parseInt(offsetStr, 10) : undefined;

          result = await runFailuresList({
            eventType: eventTypeStr,
            operation: operationStr,
            limit: limit && !Number.isNaN(limit) ? Math.max(1, Math.min(limit, 100)) : undefined,
            offset: offset && !Number.isNaN(offset) ? Math.max(0, offset) : undefined,
          });
          break;
        }
        case "stats": {
          result = await runFailuresStats();
          break;
        }
        default: {
          if (failSub) {
            outputError(
              `Unknown failures subcommand: ${failSub}\n` +
                `Available: list, stats\n` +
                `Run "code-context --help" for usage.`,
            );
          } else {
            outputError(
              `Usage: code-context failures <subcommand>\n` +
                `  list    List failure events\n` +
                `  stats   Show failure event statistics\n` +
                `Run "code-context --help" for usage.`,
            );
          }
          process.exit(1);
        }
      }
      break;
    }

    // ------------------------------------------------------------------
    // harness
    // ------------------------------------------------------------------
    case "harness": {
      const harnessSub = cmdArgs[0];
      const harnessRest = cmdArgs.slice(1);

      switch (harnessSub) {
        case "list": {
          result = runHarnessList();
          break;
        }
        case "run": {
          const flowId = harnessRest[0];
          if (!flowId) {
            outputError(
              'Usage: code-context harness run <flow-id> [--input <file>]\n' +
                '  flow-id is required.\n' +
                '  Run "code-context harness list" to see available flows.',
            );
            process.exit(1);
          }
          const inputFile = getOpt(harnessRest, "input");
          result = await runHarnessRun({ flowId, inputFile });
          break;
        }
        case "check": {
          const flowId = harnessRest[0];
          if (!flowId) {
            outputError(
              'Usage: code-context harness check <flow-id>\n' +
                '  flow-id is required.\n' +
                '  Run "code-context harness list" to see available flows.',
            );
            process.exit(1);
          }
          result = runHarnessCheck(flowId);
          break;
        }
        case "runs": {
          result = runHarnessRuns();
          break;
        }
        case "show": {
          const runId = harnessRest[0];
          if (!runId) {
            outputError(
              'Usage: code-context harness show <run-id>\n' +
                '  run-id is required.\n' +
                '  Run "code-context harness runs" to see available runs.',
            );
            process.exit(1);
          }
          result = runHarnessShow({ runId });
          break;
        }
        case "logs": {
          const runId = harnessRest[0];
          if (!runId) {
            outputError(
              'Usage: code-context harness logs <run-id>\n' +
                '  run-id is required.\n' +
                '  Run "code-context harness runs" to see available runs.',
            );
            process.exit(1);
          }
          result = runHarnessLogs({ runId });
          break;
        }
        case "artifacts": {
          const runId = harnessRest[0];
          if (!runId) {
            outputError(
              'Usage: code-context harness artifacts <run-id> [--name <artifact-name>]\n' +
                '  run-id is required.\n' +
                '  Run "code-context harness runs" to see available runs.',
            );
            process.exit(1);
          }
          const name = getOpt(harnessRest, "name");
          result = runHarnessArtifacts({ runId, name });
          break;
        }
        default: {
          if (harnessSub) {
            outputError(
              `Unknown harness subcommand: ${harnessSub}\n` +
                `Available: list, run, check, runs, show, logs, artifacts\n` +
                `Run "code-context --help" for usage.`,
            );
          } else {
            outputError(
              `Usage: code-context harness <subcommand>\n` +
                `  list       List all registered harness flows\n` +
                `  run        Execute a harness flow\n` +
                `  check      Validate a flow manifest\n` +
                `  runs       List past harness runs\n` +
                `  show       Show run details\n` +
                `  logs       Show run event logs\n` +
                `  artifacts  List run artifacts\n` +
                `Run "code-context --help" for usage.`,
            );
          }
          process.exit(1);
        }
      }
      break;
    }

    // ------------------------------------------------------------------
    // unknown / empty
    // ------------------------------------------------------------------
    case "":
    default: {
      if (command) {
        outputError(`Unknown command: ${command}\nRun "code-context --help" for usage.`);
      } else {
        outputError(`No command provided.\nRun "code-context --help" for usage.`);
      }
      process.exit(1);
    }
  }

  // Output
  if (result.status === "ok") {
    // Harness commands: human-readable by default, JSON with --json flag
    if (command === "harness" && !compactJson) {
      const harnessSub = cmdArgs[0] ?? "";
      console.log(formatHumanReadable(harnessSub, result));
    } else {
      outputResult(result, compactJson);
    }
    process.exit(0);
  } else {
    outputError(result.error ?? "Unknown error");
    process.exit(1);
  }
}

main().catch((err) => {
  outputError(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
