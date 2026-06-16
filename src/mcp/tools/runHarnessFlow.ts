/**
 * run_harness_flow MCP tool handler — PRD §11.3
 *
 * Executes a registered Harness business flow by flowId.
 * Runs the full 14-step execution pipeline and returns
 * the runId, status, output, receiptId, and artifacts.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerContext } from "../server.js";
import { runModule, hasModule, listModules } from "../../harness/core/runner.js";
import { registerAllFlows } from "../../harness/register.js";

export async function handleRunHarnessFlow(
  ctx: ServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const flowId = typeof args.flowId === "string" ? args.flowId.trim() : "";

  if (!flowId) {
    return {
      content: [{ type: "text", text: "Error: flowId is required." }],
      isError: true,
    };
  }

  // ── Ensure flows are registered ──────────────────────────────────────────
  if (!hasModule(flowId)) {
    try {
      registerAllFlows();
    } catch (err) {
      // Only ignore duplicate-registration errors; surface everything else
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("already registered")) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Failed to register flows — ${msg}`,
            },
          ],
          isError: true,
        };
      }
    }
  }

  if (!hasModule(flowId)) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Flow "${flowId}" not found. Available flows: [${listModules().join(", ")}]`,
        },
      ],
      isError: true,
    };
  }

  // ── Parse input ──────────────────────────────────────────────────────────
  const input =
    typeof args.input === "object" && args.input !== null
      ? (args.input as Record<string, unknown>)
      : {};

  // ── Execute the flow ─────────────────────────────────────────────────────
  const runState = await runModule(flowId, {
    input,
    receipts: ctx.receipts,
  });

  // ── Resolve receipts for this run ────────────────────────────────────────
  const runReceipts = ctx.receipts.getByRunId(runState.runId);

  // ── Build response ───────────────────────────────────────────────────────
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            runId: runState.runId,
            status: runState.status,
            output: runState.output ?? null,
            receiptId: runReceipts.length > 0 ? runReceipts[0]!.id : null,
            receipts: runReceipts.map((r) => ({
              id: r.id,
              operation: r.operation,
              eventType: r.eventType,
              timestamp: r.timestamp,
            })),
            artifacts: runState.artifacts.map((a) => ({
              name: a.name,
              path: a.path,
              contentType: a.contentType,
              size: a.size,
            })),
            checkpoints: {
              total: runState.checkpoints.length,
              passed: runState.checkpoints.filter((c) => c.outcome === "pass").length,
              failed: runState.checkpoints.filter((c) => c.outcome === "fail").length,
              warned: runState.checkpoints.filter((c) => c.outcome === "warn").length,
              skipped: runState.checkpoints.filter((c) => c.outcome === "skip").length,
            },
            error: runState.error ?? null,
            createdAt: runState.createdAt,
            completedAt: runState.completedAt ?? null,
          },
          null,
          2,
        ),
      },
    ],
  };
}
