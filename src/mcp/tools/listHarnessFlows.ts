/**
 * list_harness_flows MCP tool handler — PRD §11.2
 *
 * Returns all registered Harness business-flow manifests with their
 * id, name, description, phases, coveredTools, and inputSchema.
 * Supports optional filtering by tag or capability.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  listManifestDetails,
  getModule,
} from "../../harness/core/registry.js";

export async function handleListHarnessFlows(
  args: Record<string, unknown> = {},
): Promise<CallToolResult> {
  const tag = typeof args.tag === "string" ? args.tag.trim() : "";
  const capability = typeof args.capability === "string" ? args.capability.trim() : "";

  // ── Apply filters (intersection when both are provided) ──────────────────
  let manifests = listManifestDetails();
  if (tag) {
    manifests = manifests.filter((m) => m.tags?.includes(tag));
  }
  if (capability) {
    manifests = manifests.filter((m) => m.capability === capability);
  }

  const flows = manifests.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    phases: m.phases.map((p) => ({
      name: p.name,
      description: p.description,
    })),
    coveredTools: m.coversTools,
    inputSchema: m.inputSchema ?? null,
    tags: m.tags ?? [],
    capability: m.capability ?? null,
    // Indicate whether a runnable module is registered for this manifest
    hasModule: getModule(m.id) !== undefined,
  }));

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            count: flows.length,
            flows,
          },
          null,
          2,
        ),
      },
    ],
  };
}
