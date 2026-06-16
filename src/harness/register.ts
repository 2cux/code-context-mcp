/**
 * Harness Flow Registration
 *
 * Assembles all 7 CodeContext HarnessModules with proper generic typing
 * and registers them with the unified HarnessRegistry.
 *
 * Each flow bundles a business-capability manifest with its execution
 * logic. Adapters (CodeContextAdapter, McpAdapter, CliAdapter) are
 * injected through HarnessContext.input at runtime.
 *
 * Registration order is deterministic but not order-dependent.
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
import type { CompressionFlowInput, CompressionFlowOutput } from "./flows/compressionFlow.js";

import { originalsFlow } from "./flows/originalsFlow.js";
import type { OriginalsFlowInput, OriginalsFlowOutput } from "./flows/originalsFlow.js";

import { memoryFlow } from "./flows/memoryFlow.js";
import type { MemoryFlowInput, MemoryFlowOutput } from "./flows/memoryFlow.js";

import { profileFlow } from "./flows/profileFlow.js";
import type { ProfileFlowInput, ProfileFlowOutput } from "./flows/profileFlow.js";

import { fullContextFlow } from "./flows/fullContextFlow.js";
import type { FullContextFlowInput, FullContextFlowOutput } from "./flows/fullContextFlow.js";

import { mcpToolsSmokeFlow } from "./flows/mcpToolsSmokeFlow.js";
import type { McpToolsSmokeFlowInput, McpToolsSmokeFlowOutput } from "./flows/mcpToolsSmokeFlow.js";

import { cliSmokeFlow } from "./flows/cliSmokeFlow.js";
import type { CliSmokeFlowInput, CliSmokeFlowOutput } from "./flows/cliSmokeFlow.js";

// ── Output Schemas ────────────────────────────────────────────────────────────

import { compressionFlowOutputSchema } from "./schemas/compressionFlow.schema.js";
import { memoryFlowOutputSchema } from "./schemas/memoryFlow.schema.js";
import { fullContextFlowOutputSchema } from "./schemas/fullContextFlow.schema.js";

// ── Module Assembly ───────────────────────────────────────────────────────────

/**
 * 9.1 Compression Flow
 *
 * Exercises: current_scope, compress_context, retrieve_original,
 *   list_compressions, get_receipt
 * Adapter: CodeContextAdapter (injected via ctx.input)
 */
const compressionModule: HarnessModule<CompressionFlowInput, CompressionFlowOutput> = {
  manifest: {
    ...compressionFlowManifest,
    outputSchema: compressionFlowOutputSchema,
  },
  run: compressionFlow,
};

/**
 * 9.2 Originals Flow (most critical)
 *
 * Exercises: compress_context, retrieve_original, delete_original,
 *   cleanup_originals
 * Adapter: CodeContextAdapter (injected via ctx.input)
 */
const originalsModule: HarnessModule<OriginalsFlowInput, OriginalsFlowOutput> = {
  manifest: originalsFlowManifest,
  run: originalsFlow,
};

/**
 * 9.3 Memory Flow
 *
 * Exercises: remember_context, recall_context, forget_context,
 *   list_context
 * Adapter: CodeContextAdapter (injected via ctx.input)
 */
const memoryModule: HarnessModule<MemoryFlowInput, MemoryFlowOutput> = {
  manifest: {
    ...memoryFlowManifest,
    outputSchema: memoryFlowOutputSchema,
  },
  run: memoryFlow,
};

/**
 * 9.4 Profile Flow
 *
 * Exercises: remember_context, recall_context, repo_profile.static,
 *   repo_profile.dynamic
 * Adapter: CodeContextAdapter (injected via ctx.input)
 */
const profileModule: HarnessModule<ProfileFlowInput, ProfileFlowOutput> = {
  manifest: profileFlowManifest,
  run: profileFlow,
};

/**
 * 9.5 Full Context Flow (final acceptance)
 *
 * Exercises the complete main value chain:
 *   current_scope, compress_context, retrieve_original,
 *   remember_context, recall_context, forget_context,
 *   list_context, get_receipt
 * Adapter: CodeContextAdapter (injected via ctx.input)
 */
const fullContextModule: HarnessModule<FullContextFlowInput, FullContextFlowOutput> = {
  manifest: {
    ...fullContextFlowManifest,
    outputSchema: fullContextFlowOutputSchema,
  },
  run: fullContextFlow,
};

/**
 * 9.6 MCP Tools Smoke Flow
 *
 * Exercises all 13 MCP tools.
 * Adapter: McpAdapter (injected via ctx.input)
 */
const mcpToolsSmokeModule: HarnessModule<McpToolsSmokeFlowInput, McpToolsSmokeFlowOutput> = {
  manifest: mcpToolsSmokeFlowManifest,
  run: mcpToolsSmokeFlow,
};

/**
 * 9.7 CLI Smoke Flow
 *
 * Exercises all CLI commands.
 * Adapter: CliAdapter (injected via ctx.input)
 */
const cliSmokeModule: HarnessModule<CliSmokeFlowInput, CliSmokeFlowOutput> = {
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

// ── Type re-exports ───────────────────────────────────────────────────────────

export type {
  CompressionFlowInput,
  CompressionFlowOutput,
  OriginalsFlowInput,
  OriginalsFlowOutput,
  MemoryFlowInput,
  MemoryFlowOutput,
  ProfileFlowInput,
  ProfileFlowOutput,
  FullContextFlowInput,
  FullContextFlowOutput,
  McpToolsSmokeFlowInput,
  McpToolsSmokeFlowOutput,
  CliSmokeFlowInput,
  CliSmokeFlowOutput,
};
