/**
 * check_harness_flow MCP tool handler — PRD §11.5
 *
 * Validates a harness flow manifest without executing it.
 * Checks:
 *   1. Manifest is well-formed and registered
 *   2. Example input conforms to the declared inputSchema (if provided)
 *   3. Manifest structure is valid (phases, checkpoints, artifacts)
 *   4. Artifact declarations are valid
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  getManifest,
  hasModule,
  listManifests,
} from "../../harness/core/registry.js";
import { validateJsonSchema } from "../../harness/core/validate.js";
import { registerAllFlows } from "../../harness/register.js";
import type { HarnessManifest } from "../../harness/core/types.js";

// ── Check Result ───────────────────────────────────────────────────────────

interface FlowCheckResult {
  /** Whether the flow manifest is valid overall. */
  valid: boolean;
  /** Individual check results. */
  checks: {
    manifestExists: boolean;
    manifestWellFormed: boolean;
    manifestWarnings: string[];
    inputValid: boolean | null; // null = no example input provided
    inputErrors: string[];
    artifactsValid: boolean;
    artifactWarnings: string[];
  };
  /** Human-readable summary. */
  summary: string;
}

// ── Handler ────────────────────────────────────────────────────────────────

export async function handleCheckHarnessFlow(
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

  // ── Check 1: Manifest exists ─────────────────────────────────────────────
  const manifest = getManifest(flowId);
  const manifestExists = manifest !== undefined;

  const result: FlowCheckResult = {
    valid: true,
    checks: {
      manifestExists,
      manifestWellFormed: false,
      manifestWarnings: [],
      inputValid: null,
      inputErrors: [],
      artifactsValid: false,
      artifactWarnings: [],
    },
    summary: "",
  };

  if (!manifestExists) {
    result.valid = false;
    result.summary = `Flow "${flowId}" not found. Available: [${listManifests().join(", ") || "none"}]`;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  // ── Check 2: Manifest well-formed ────────────────────────────────────────
  const wellFormed = checkManifestWellFormed(manifest);
  result.checks.manifestWellFormed = wellFormed.valid;
  result.checks.manifestWarnings = wellFormed.warnings;
  if (!wellFormed.valid) result.valid = false;

  // ── Check 3: Example input valid ─────────────────────────────────────────
  const exampleInput = args.exampleInput;
  if (exampleInput !== undefined) {
    const inputValidation = validateJsonSchema(
      manifest.inputSchema,
      exampleInput,
      "exampleInput",
    );
    result.checks.inputValid = inputValidation.valid;
    result.checks.inputErrors = inputValidation.errors;
    if (!inputValidation.valid) result.valid = false;
  }

  // ── Check 4: Artifacts valid ─────────────────────────────────────────────
  const artifactsCheck = checkArtifactsValid(manifest);
  result.checks.artifactsValid = artifactsCheck.valid;
  result.checks.artifactWarnings = artifactsCheck.warnings;
  if (!artifactsCheck.valid) result.valid = false;

  // ── Build summary ───────────────────────────────────────────────────────
  const parts: string[] = [];
  parts.push(`manifestExists: ${manifestExists ? "✓" : "✗"}`);
  parts.push(`manifestWellFormed: ${wellFormed.valid ? "✓" : "✗"}`);
  if (exampleInput !== undefined) {
    parts.push(`inputValid: ${result.checks.inputValid ? "✓" : "✗"}`);
  } else {
    parts.push("inputValid: (no example input provided)");
  }
  parts.push(`artifactsValid: ${artifactsCheck.valid ? "✓" : "✗"}`);

  result.summary = `Flow "${flowId}": ${result.valid ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"} — ${parts.join(", ")}`;

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

// ── Internal Check Helpers ─────────────────────────────────────────────────

interface WellFormedCheck {
  valid: boolean;
  warnings: string[];
}

/**
 * Validate that a manifest has the required structure:
 *   - Non-empty id
 *   - Non-empty name
 *   - Non-empty description
 *   - At least one phase
 *   - Each phase has name + description
 *   - Each checkpoint declaration has name + description + expect
 *   - Each artifact declaration has name + description
 */
function checkManifestWellFormed(manifest: HarnessManifest): WellFormedCheck {
  const warnings: string[] = [];

  if (!manifest.id || manifest.id.trim().length === 0) {
    warnings.push("manifest.id is empty");
  }
  if (!manifest.name || manifest.name.trim().length === 0) {
    warnings.push("manifest.name is empty");
  }
  if (!manifest.description || manifest.description.trim().length === 0) {
    warnings.push("manifest.description is empty");
  }

  // Phases
  if (!manifest.phases || manifest.phases.length === 0) {
    warnings.push("manifest.phases is empty — at least one phase is required");
  } else {
    for (let i = 0; i < manifest.phases.length; i++) {
      const p = manifest.phases[i]!;
      if (!p.name || p.name.trim().length === 0) {
        warnings.push(`manifest.phases[${i}].name is empty`);
      }
      if (!p.description || p.description.trim().length === 0) {
        warnings.push(`manifest.phases[${i}].description is empty`);
      }
    }
  }

  // Checkpoints
  if (manifest.checkpoints) {
    // Collect declared phase names for cross-validation
    const phaseNames = new Set(
      (manifest.phases ?? []).map((p) => p.name),
    );

    for (let i = 0; i < manifest.checkpoints.length; i++) {
      const c = manifest.checkpoints[i]!;
      if (!c.name || c.name.trim().length === 0) {
        warnings.push(`manifest.checkpoints[${i}].name is empty`);
      }
      if (!c.description || c.description.trim().length === 0) {
        warnings.push(`manifest.checkpoints[${i}].description is empty`);
      }
      if (!c.expect) {
        warnings.push(
          `manifest.checkpoints[${i}].expect is missing for "${c.name || `#${i}`}"`,
        );
      }
      // Cross-validate: checkpoint name prefix should reference a declared phase
      // Convention: "phaseName:checkpointLabel" (e.g. "compress:execute")
      // Lifecycle prefixes ("run", "system", "setup", "check") are always allowed.
      const LIFECYCLE_PREFIXES = new Set(["run", "system", "setup", "check"]);
      const colonIdx = c.name?.indexOf(":") ?? -1;
      if (colonIdx > 0) {
        const phaseRef = c.name!.substring(0, colonIdx);
        if (!phaseNames.has(phaseRef) && !LIFECYCLE_PREFIXES.has(phaseRef)) {
          warnings.push(
            `manifest.checkpoints[${i}] ("${c.name}"): phase prefix "${phaseRef}" not found in declared phases [${[...phaseNames].join(", ")}]`,
          );
        }
      }
    }
  }

  // CoversTools
  if (!manifest.coversTools || manifest.coversTools.length === 0) {
    warnings.push("manifest.coversTools is empty — should declare covered MCP tools");
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

/**
 * Validate artifact declarations:
 *   - At least one artifact declared (recommended, not required)
 *   - Each artifact has a non-empty name and description
 */
function checkArtifactsValid(manifest: HarnessManifest): WellFormedCheck {
  const warnings: string[] = [];

  if (!manifest.artifacts || manifest.artifacts.length === 0) {
    warnings.push(
      "manifest.artifacts is empty — no artifacts declared (allowed but unusual)",
    );
    // Empty artifacts is not a hard failure — just a warning
    return { valid: true, warnings };
  }

  for (let i = 0; i < manifest.artifacts.length; i++) {
    const a = manifest.artifacts[i]!;
    if (!a.name || a.name.trim().length === 0) {
      warnings.push(`manifest.artifacts[${i}].name is empty`);
    }
    if (!a.description || a.description.trim().length === 0) {
      warnings.push(`manifest.artifacts[${i}].description is empty`);
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}
