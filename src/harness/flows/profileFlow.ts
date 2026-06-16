/**
 * Profile Closed-Loop Flow
 *
 * Exercises the repo profile loop:
 *   save static fact → save dynamic context → recall with profile →
 *   verify static → verify dynamic → write report
 *
 * PRD §34 / §9.4: profile 闭环。
 */

import type { HarnessContext } from "../core/types.js";
import type { CodeContextAdapter, RememberResult } from "../adapters/codeContextAdapter.js";

// ── Input Types ────────────────────────────────────────────────────────────────

export interface ProfileFlowInput {
  adapter: CodeContextAdapter;
}

// ── Output Types ───────────────────────────────────────────────────────────────

export interface ProfileFactRecord {
  label: string;
  category: "static" | "dynamic";
  memoryId: string;
  content: string;
  type: string;
  status: string;
  verified: boolean;
}

export interface ProfileFlowOutput {
  staticFacts: number;
  dynamicFacts: number;
  totalFacts: number;
  verifiedFacts: number;
  facts: ProfileFactRecord[];
}

// ── Flow Implementation ────────────────────────────────────────────────────────

export async function profileFlow(
  ctx: HarnessContext<ProfileFlowInput>,
): Promise<ProfileFlowOutput> {
  const { adapter } = ctx.input;
  const facts: ProfileFactRecord[] = [];
  let staticFacts = 0;
  let dynamicFacts = 0;

  // ── Phase 1: save_static_fact ────────────────────────────────────────────────

  ctx.phase("save_static_fact");
  ctx.log("Saving static profile facts...");

  const staticFixtures = [
    {
      label: "framework",
      content: "This project uses TypeScript with Node.js runtime",
      type: "project_rule" as const,
      tags: ["static", "framework"],
    },
    {
      label: "language",
      content: "Primary language: TypeScript 5.x, target: ES2022",
      type: "project_rule" as const,
      tags: ["static", "language"],
    },
  ];

  for (const fixture of staticFixtures) {
    try {
      const result: RememberResult = adapter.runRememberContext(
        fixture.content,
        fixture.type,
        fixture.tags,
      );
      facts.push({
        label: fixture.label,
        category: "static",
        memoryId: result.memoryId,
        content: fixture.content,
        type: result.type,
        status: result.status,
        verified: false,
      });
      staticFacts++;
      ctx.log(`Saved static fact "${fixture.label}": ${result.memoryId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log(`Failed to save static fact "${fixture.label}": ${msg}`);
    }
  }

  ctx.checkpoint(
    "profile:save_static_fact",
    staticFacts === staticFixtures.length ? "pass" : "fail",
    `saved=${staticFacts}/${staticFixtures.length}`,
  );

  // ── Phase 2: save_dynamic_context ────────────────────────────────────────────

  ctx.phase("save_dynamic_context");
  ctx.log("Saving dynamic context facts...");

  const dynamicFixtures = [
    {
      label: "current_task",
      content: "Current task: implementing profile flow harness",
      type: "current_task" as const,
      tags: ["dynamic", "task"],
    },
    {
      label: "recent_decision",
      content: "Decision: use SQLite FTS for memory retrieval with RecallEngine",
      type: "decision" as const,
      tags: ["dynamic", "decision"],
    },
  ];

  for (const fixture of dynamicFixtures) {
    try {
      const result: RememberResult = adapter.runRememberContext(
        fixture.content,
        fixture.type,
        fixture.tags,
      );
      facts.push({
        label: fixture.label,
        category: "dynamic",
        memoryId: result.memoryId,
        content: fixture.content,
        type: result.type,
        status: result.status,
        verified: false,
      });
      dynamicFacts++;
      ctx.log(`Saved dynamic fact "${fixture.label}": ${result.memoryId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log(`Failed to save dynamic fact "${fixture.label}": ${msg}`);
    }
  }

  ctx.checkpoint(
    "profile:save_dynamic_context",
    dynamicFacts === dynamicFixtures.length ? "pass" : "fail",
    `saved=${dynamicFacts}/${dynamicFixtures.length}`,
  );

  // ── Phase 3: recall_with_profile ─────────────────────────────────────────────

  ctx.phase("recall_with_profile");
  ctx.log("Recalling with profile enrichment...");

  let recallEnriched = false;
  try {
    const recallResult = adapter.runRecallContext("TypeScript Node.js", 10);
    // Check that recall returns results (profile enrichment enriches the context)
    recallEnriched = recallResult.total > 0;

    ctx.checkpoint(
      "profile:recall_enriched",
      recallEnriched ? "pass" : "warn",
      `total=${recallResult.total} enriched=${recallEnriched}`,
    );
    ctx.log(`Recall returned ${recallResult.total} results`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.checkpoint("profile:recall_enriched", "fail", msg);
  }

  // ── Phase 4: verify_static_profile ───────────────────────────────────────────

  ctx.phase("verify_static_profile");
  ctx.log("Verifying static profile facts...");

  let staticVerified = 0;
  for (const fact of facts.filter((f) => f.category === "static")) {
    try {
      const recallResult = adapter.runRecallContext(fact.content.split(":")[0] ?? fact.label, 20);
      const found = recallResult.items.some((item) => item.id === fact.memoryId);
      if (found) {
        fact.verified = true;
        staticVerified++;
      }
      ctx.log(`Static fact "${fact.label}" verified: ${found}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log(`Failed to verify static fact "${fact.label}": ${msg}`);
    }
  }

  ctx.checkpoint(
    "profile:verify_static",
    staticVerified === staticFacts ? "pass" : "fail",
    `verified=${staticVerified}/${staticFacts}`,
  );

  // ── Phase 5: verify_dynamic_profile ──────────────────────────────────────────

  ctx.phase("verify_dynamic_profile");
  ctx.log("Verifying dynamic context facts...");

  let dynamicVerified = 0;
  for (const fact of facts.filter((f) => f.category === "dynamic")) {
    try {
      const recallResult = adapter.runRecallContext(fact.label.replace(/_/g, " "), 20);
      const found = recallResult.items.some((item) => item.id === fact.memoryId);
      if (found) {
        fact.verified = true;
        dynamicVerified++;
      }
      ctx.log(`Dynamic fact "${fact.label}" verified: ${found}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log(`Failed to verify dynamic fact "${fact.label}": ${msg}`);
    }
  }

  ctx.checkpoint(
    "profile:verify_dynamic",
    dynamicVerified === dynamicFacts ? "pass" : "fail",
    `verified=${dynamicVerified}/${dynamicFacts}`,
  );

  // ── Phase 6: write_report ────────────────────────────────────────────────────

  ctx.phase("write_report");

  // List all context for audit
  try {
    const listResult = adapter.runListContext(undefined, 50, 0);
    ctx.checkpoint(
      "profile:list_context",
      "pass",
      `total=${listResult.items?.length ?? 0}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.checkpoint("profile:list_context", "fail", msg);
  }

  const totalFacts = facts.length;
  const verifiedFacts = facts.filter((f) => f.verified).length;

  const output: ProfileFlowOutput = {
    staticFacts,
    dynamicFacts,
    totalFacts,
    verifiedFacts,
    facts,
  };

  ctx.writeArtifact(
    "profile-snapshot",
    JSON.stringify(facts, null, 2),
    "application/json",
  );
  ctx.writeArtifact(
    "profile-report",
    JSON.stringify(output, null, 2),
    "application/json",
  );

  ctx.log(`Profile flow complete: ${verifiedFacts}/${totalFacts} facts verified`);
  return output;
}
