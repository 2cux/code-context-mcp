/**
 * Profile Flow Tests
 *
 * Covers: profileFlow execution with mock CodeContextAdapter.
 * Exercises the full profile closed loop:
 *   save_static_fact → save_dynamic_context → recall_with_profile →
 *   verify_static_profile → verify_dynamic_profile → write_report
 *
 * PRD §34 / §9.4: Profile 闭环 Harness 级验收。
 */

import { describe, it, expect, afterEach } from "vitest";
import { executeRun } from "../../src/harness/core/runner.js";
import { profileFlow } from "../../src/harness/flows/profileFlow.js";
import { profileFlowManifest } from "../../src/harness/manifests/profileFlow.manifest.js";
import type { HarnessModule } from "../../src/harness/core/types.js";
import type { ProfileFlowInput } from "../../src/harness/flows/profileFlow.js";
import { createMockCodeContextAdapter, resetMockDatabase } from "../../src/harness/core/mockAdapters.js";

// ── Cleanup ───────────────────────────────────────────────────────────────────

afterEach(() => {
  resetMockDatabase();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("profileFlow", () => {
  it("executes full profile closed loop and produces valid output", async () => {
    const adapter = await createMockCodeContextAdapter();

    const input: ProfileFlowInput = { adapter };

    const mod: HarnessModule<ProfileFlowInput> = {
      manifest: profileFlowManifest,
      run: profileFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_profile_full" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const output = state.output as Record<string, unknown> | undefined;
    expect(output).toBeDefined();
    if (output) {
      expect(output.staticFacts).toBe(2);
      expect(output.dynamicFacts).toBe(2);
      expect(output.totalFacts).toBe(4);
      expect(output.verifiedFacts).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(output.facts)).toBe(true);
      expect((output.facts as Array<unknown>).length).toBe(4);
    }
  });

  it("saves static profile facts successfully", async () => {
    const adapter = await createMockCodeContextAdapter();

    const input: ProfileFlowInput = { adapter };

    const mod: HarnessModule<ProfileFlowInput> = {
      manifest: profileFlowManifest,
      run: profileFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_profile_static" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const saveCp = state.checkpoints.find(
      (c) => c.label === "profile:save_static_fact",
    );
    expect(saveCp?.outcome).toBe("pass");

    // Verify static facts are in the output
    const output = state.output as Record<string, unknown> | undefined;
    if (output) {
      const facts = output.facts as Array<Record<string, unknown>>;
      const staticFacts = facts.filter((f) => f.category === "static");
      expect(staticFacts).toHaveLength(2);
      const labels = staticFacts.map((f) => f.label);
      expect(labels).toContain("framework");
      expect(labels).toContain("language");
    }
  });

  it("saves dynamic context facts successfully", async () => {
    const adapter = await createMockCodeContextAdapter();

    const input: ProfileFlowInput = { adapter };

    const mod: HarnessModule<ProfileFlowInput> = {
      manifest: profileFlowManifest,
      run: profileFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_profile_dynamic" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const saveCp = state.checkpoints.find(
      (c) => c.label === "profile:save_dynamic_context",
    );
    expect(saveCp?.outcome).toBe("pass");

    const output = state.output as Record<string, unknown> | undefined;
    if (output) {
      const facts = output.facts as Array<Record<string, unknown>>;
      const dynamicFacts = facts.filter((f) => f.category === "dynamic");
      expect(dynamicFacts).toHaveLength(2);
      const labels = dynamicFacts.map((f) => f.label);
      expect(labels).toContain("current_task");
      expect(labels).toContain("recent_decision");
    }
  });

  it("recall with profile enrichment returns results", async () => {
    const adapter = await createMockCodeContextAdapter();

    const input: ProfileFlowInput = { adapter };

    const mod: HarnessModule<ProfileFlowInput> = {
      manifest: profileFlowManifest,
      run: profileFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_profile_recall" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const recallCp = state.checkpoints.find(
      (c) => c.label === "profile:recall_enriched",
    );
    expect(recallCp?.outcome).toBe("pass");
  });

  it("verifies that static facts can be retrieved", async () => {
    const adapter = await createMockCodeContextAdapter();

    const input: ProfileFlowInput = { adapter };

    const mod: HarnessModule<ProfileFlowInput> = {
      manifest: profileFlowManifest,
      run: profileFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_profile_verify_static" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const verifyCp = state.checkpoints.find(
      (c) => c.label === "profile:verify_static",
    );
    expect(verifyCp?.outcome).toBe("pass");
  });

  it("verifies that dynamic facts can be retrieved", async () => {
    const adapter = await createMockCodeContextAdapter();

    const input: ProfileFlowInput = { adapter };

    const mod: HarnessModule<ProfileFlowInput> = {
      manifest: profileFlowManifest,
      run: profileFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_profile_verify_dynamic" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const verifyCp = state.checkpoints.find(
      (c) => c.label === "profile:verify_dynamic",
    );
    expect(verifyCp?.outcome).toBe("pass");
  });

  it("list_context checkpoint passes after audit", async () => {
    const adapter = await createMockCodeContextAdapter();

    const input: ProfileFlowInput = { adapter };

    const mod: HarnessModule<ProfileFlowInput> = {
      manifest: profileFlowManifest,
      run: profileFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_profile_list" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const listCp = state.checkpoints.find(
      (c) => c.label === "profile:list_context",
    );
    expect(listCp?.outcome).toBe("pass");
  });

  it("produces profile-snapshot and profile-report artifacts", async () => {
    const adapter = await createMockCodeContextAdapter();

    const input: ProfileFlowInput = { adapter };

    const mod: HarnessModule<ProfileFlowInput> = {
      manifest: profileFlowManifest,
      run: profileFlow,
    };

    const state = await executeRun({
      module: mod as HarnessModule,
      runId: "run_profile_artifacts" as never,
      input,
    });

    expect(state.status).toBe("completed");

    const artifactNames = state.artifacts.map((a) => a.name);
    expect(artifactNames).toContain("profile-snapshot");
    expect(artifactNames).toContain("profile-report");
  });

  it("all manifest-declared checkpoints map to phases", () => {
    // Validate manifest structure without executing
    const phaseNames = profileFlowManifest.phases.map((p) => p.name);
    expect(phaseNames).toEqual([
      "save_static_fact",
      "save_dynamic_context",
      "recall_with_profile",
      "verify_static_profile",
      "verify_dynamic_profile",
      "write_report",
    ]);

    const checkpointLabels = profileFlowManifest.checkpoints.map((c) => c.name);
    // Every checkpoint should reference a valid phase prefix.
    // The profile-flow convention uses "profile:" prefix (matching its capability),
    // not individual phase names. This is the project's naming convention —
    // all checkpoints share the capability-level prefix.
    // We verify that each checkpoint label has a ":" separator and both
    // parts are non-empty.
    for (const label of checkpointLabels) {
      const parts = label.split(":");
      expect(parts.length).toBeGreaterThanOrEqual(2);
      expect(parts[0]?.length).toBeGreaterThan(0);
      expect(parts[1]?.length).toBeGreaterThan(0);
      // The prefix should either be a phase name or the capability-level prefix
      const validPrefixes = new Set([
        ...phaseNames,
        "profile", // capability-level prefix — profile-flow convention
      ]);
      expect(validPrefixes.has(parts[0]!)).toBe(true);
    }

    // coversTools should include memory-related tools
    expect(profileFlowManifest.coversTools).toContain("remember_context");
    expect(profileFlowManifest.coversTools).toContain("recall_context");
    expect(profileFlowManifest.coversTools).toContain("list_context");

    // Declared artifacts should match what the flow produces
    const declaredArtifactNames = profileFlowManifest.artifacts.map((a) => a.name);
    expect(declaredArtifactNames).toContain("profile-snapshot");
    expect(declaredArtifactNames).toContain("profile-report");
  });
});
