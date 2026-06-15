/**
 * Harness Flow Registration
 *
 * Assembles all 7 CodeContext HarnessModules and registers them with
 * the unified HarnessRegistry.
 *
 * Each flow bundles a business-capability manifest with its execution
 * logic (stub or real). Registration order is deterministic but not
 * order-dependent.
 *
 * PRD §34: 第一批注册的 7 个 CodeContext Flow。
 */

import { registerModules } from "./core/registry.js";
import type { HarnessModule } from "./core/types.js";

// ── Manifests ─────────────────────────────────────────────────────────────────

import { compressionFlowManifest } from "./manifests/compressionFlow.manifest.js";
import { originalsFlowManifest } from "./manifests/originalsFlow.manifest.js";
import { memoryFlowManifest } from "./manifests/memoryFlow.manifest.js";
import { profileFlowManifest } from "./manifests/profileFlow.manifest.js";
import { fullContextFlowManifest } from "./manifests/fullContextFlow.manifest.js";
import { mcpToolsSmokeFlowManifest } from "./manifests/mcpToolsSmokeFlow.manifest.js";
import { cliSmokeFlowManifest } from "./manifests/cliSmokeFlow.manifest.js";

// ── Flow Implementations ──────────────────────────────────────────────────────

import { compressionFlow } from "./flows/compressionFlow.js";
import { originalsFlow } from "./flows/originalsFlow.js";
import { memoryFlow } from "./flows/memoryFlow.js";
import { profileFlow } from "./flows/profileFlow.js";
import { fullContextFlow } from "./flows/fullContextFlow.js";
import { mcpToolsSmokeFlow } from "./flows/mcpToolsSmokeFlow.js";
import { cliSmokeFlow } from "./flows/cliSmokeFlow.js";

// ── Module Assembly ───────────────────────────────────────────────────────────

const compressionModule: HarnessModule = {
  manifest: compressionFlowManifest,
  run: compressionFlow,
};

const originalsModule: HarnessModule = {
  manifest: originalsFlowManifest,
  run: originalsFlow,
};

const memoryModule: HarnessModule = {
  manifest: memoryFlowManifest,
  run: memoryFlow,
};

const profileModule: HarnessModule = {
  manifest: profileFlowManifest,
  run: profileFlow,
};

const fullContextModule: HarnessModule = {
  manifest: fullContextFlowManifest,
  run: fullContextFlow,
};

const mcpToolsSmokeModule: HarnessModule = {
  manifest: mcpToolsSmokeFlowManifest,
  run: mcpToolsSmokeFlow,
};

const cliSmokeModule: HarnessModule = {
  manifest: cliSmokeFlowManifest,
  run: cliSmokeFlow,
};

// ── Register All ──────────────────────────────────────────────────────────────

/**
 * Register all 7 CodeContext HarnessModules with the HarnessRegistry.
 *
 * Call once at startup to populate the registry.
 * NOT safe to call multiple times — throws on duplicate registration.
 * Guard with hasModule() if you need to check before calling.
 */
export function registerAllFlows(): void {
  registerModules([
    compressionModule,
    originalsModule,
    memoryModule,
    profileModule,
    fullContextModule,
    mcpToolsSmokeModule,
    cliSmokeModule,
  ]);
}

// ── Re-exports for convenience ────────────────────────────────────────────────

export {
  compressionModule,
  originalsModule,
  memoryModule,
  profileModule,
  fullContextModule,
  mcpToolsSmokeModule,
  cliSmokeModule,
};
