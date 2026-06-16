/**
 * get_harness_run MCP tool handler — PRD §11.4
 *
 * Retrieves the full state of a previous harness run by runId.
 * Returns the run state, associated receipts, event logs,
 * artifact listings, and artifact contents (size-limited).
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerContext } from "../server.js";
import { loadState, listRuns } from "../../harness/core/stateStore.js";
import { readLogs, readCheckpoints } from "../../harness/core/reporter.js";
import {
  listArtifacts,
  readArtifact,
} from "../../harness/core/artifactStore.js";
import type { RunId } from "../../harness/core/types.js";

// ── Constants ──────────────────────────────────────────────────────────────

/** Maximum bytes to read from a single artifact (1 MB). */
const MAX_ARTIFACT_BYTES = 1_048_576;

/** Valid runId pattern: run_<date>_<random>_<seq> (e.g. run_20260615_abc123_001). */
const RUN_ID_RE = /^run_[a-z0-9]+_[a-z0-9]+_[0-9]+$/;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Validate a user-supplied runId string before using it in filesystem paths.
 * Prevents path traversal attacks (e.g. "../../../etc/passwd").
 */
function validateRunId(raw: string): RunId | null {
  if (!RUN_ID_RE.test(raw)) return null;
  return raw as RunId;
}

// ── Handler ────────────────────────────────────────────────────────────────

export async function handleGetHarnessRun(
  ctx: ServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const rawRunId = typeof args.runId === "string" ? args.runId.trim() : "";

  if (!rawRunId) {
    return {
      content: [{ type: "text", text: "Error: runId is required." }],
      isError: true,
    };
  }

  // ── Validate runId format (path traversal protection) ────────────────────
  const runId = validateRunId(rawRunId);
  if (!runId) {
    return {
      content: [
        {
          type: "text",
          text:
            `Error: Invalid runId format "${rawRunId}". ` +
            `Expected format: run_<date>_<random>_<seq> (e.g. "run_20260615_abc123_001").`,
        },
      ],
      isError: true,
    };
  }

  // ── Load run state ───────────────────────────────────────────────────────
  const state = loadState(runId);

  if (!state) {
    const allRuns = listRuns();
    return {
      content: [
        {
          type: "text",
          text: `Error: Run "${rawRunId}" not found. Available runs: [${allRuns.join(", ") || "none"}]`,
        },
      ],
      isError: true,
    };
  }

  // ── Read logs ────────────────────────────────────────────────────────────
  const logs = readLogs(runId);

  // ── Read checkpoints ─────────────────────────────────────────────────────
  const checkpoints = readCheckpoints(runId);

  // ── Read artifact names ──────────────────────────────────────────────────
  const artifactNames = listArtifacts(runId);

  // ── Read artifact contents (size-limited) ────────────────────────────────
  const artifacts: Record<string, { size: number; content?: string; truncated?: boolean }> = {};
  for (const name of artifactNames) {
    const fullContent = readArtifact(runId, name);
    if (fullContent === undefined) {
      artifacts[name] = { size: 0 };
      continue;
    }
    const byteLength = Buffer.byteLength(fullContent, "utf-8");
    if (byteLength <= MAX_ARTIFACT_BYTES) {
      artifacts[name] = { size: byteLength, content: fullContent };
    } else {
      // Size-limited: return first N bytes + truncation marker
      // Use a byte-aware truncation to avoid splitting multi-byte characters
      const buf = Buffer.from(fullContent, "utf-8");
      const truncated = buf.subarray(0, MAX_ARTIFACT_BYTES).toString("utf-8");
      artifacts[name] = {
        size: byteLength,
        content: truncated,
        truncated: true,
      };
    }
  }

  // ── Look up receipts ─────────────────────────────────────────────────────
  const runReceipts = ctx.receipts.getByRunId(runId);

  // ── Build response ───────────────────────────────────────────────────────
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            runId: state.runId,
            state: {
              status: state.status,
              moduleId: state.moduleId,
              currentPhase: state.currentPhase,
              input: state.input,
              output: state.output ?? null,
              error: state.error ?? null,
              createdAt: state.createdAt,
              updatedAt: state.updatedAt,
              completedAt: state.completedAt ?? null,
            },
            receipt: runReceipts.length > 0
              ? {
                  id: runReceipts[0]!.id,
                  operation: runReceipts[0]!.operation,
                  eventType: runReceipts[0]!.eventType,
                  timestamp: runReceipts[0]!.timestamp,
                  failed: runReceipts[0]!.failed,
                  errorReason: runReceipts[0]!.errorReason,
                  coveredTools: runReceipts[0]!.coveredTools,
                  artifactPaths: runReceipts[0]!.artifactPaths,
                }
              : null,
            receipts: runReceipts.map((r) => ({
              id: r.id,
              operation: r.operation,
              eventType: r.eventType,
              phase: r.phase,
              timestamp: r.timestamp,
              failed: r.failed,
              errorReason: r.errorReason,
            })),
            logs: {
              count: logs.length,
              entries: logs,
            },
            checkpoints: {
              count: checkpoints.length,
              passed: checkpoints.filter((c) => c.outcome === "pass").length,
              failed: checkpoints.filter((c) => c.outcome === "fail").length,
              warned: checkpoints.filter((c) => c.outcome === "warn").length,
              skipped: checkpoints.filter((c) => c.outcome === "skip").length,
              entries: checkpoints,
            },
            artifacts: {
              count: artifactNames.length,
              names: artifactNames,
              contents: artifacts,
            },
          },
          null,
          2,
        ),
      },
    ],
  };
}
