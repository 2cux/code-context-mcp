/**
 * HarnessRegistry
 *
 * Unified registry for HarnessManifests and HarnessModules.
 * Single source of truth for which manifests and modules are available.
 *
 * Capabilities:
 *   - Register manifests and modules
 *   - Check duplicate ids
 *   - Get manifest/module by id
 *   - List all manifests
 *   - Reverse-lookup flows by coveredTools
 *   - Filter flows by tag or capability
 *
 * PRD §34: Manifest 声明要执行哪个闭环，不声明具体工具调用序列。
 */

import type { HarnessManifest, HarnessModule } from "./types.js";

// ── Registry State ────────────────────────────────────────────────────────────

/** Manifest store: id → frozen HarnessManifest. */
const manifests = new Map<string, HarnessManifest>();

/** Module store: id → HarnessModule (manifest + execution logic). */
const modules = new Map<string, HarnessModule>();

// ── Manifest Operations ───────────────────────────────────────────────────────

/** Register a manifest. Throws if a manifest with the same id is already registered. */
export function registerManifest(manifest: HarnessManifest): void {
  if (manifests.has(manifest.id)) {
    throw new Error(`Manifest "${manifest.id}" is already registered.`);
  }
  manifests.set(manifest.id, Object.freeze({ ...manifest }));
}

/** Register multiple manifests at once. */
export function registerManifests(list: HarnessManifest[]): void {
  for (const m of list) {
    registerManifest(m);
  }
}

/** Get a manifest by id. Returns undefined if not found. */
export function getManifest(id: string): HarnessManifest | undefined {
  return manifests.get(id);
}

/** List all registered manifest ids (sorted). */
export function listManifests(): string[] {
  return [...manifests.keys()].sort();
}

/** List all registered manifests with full details. */
export function listManifestDetails(): HarnessManifest[] {
  return [...manifests.values()];
}

// ── Module Operations ─────────────────────────────────────────────────────────

/**
 * Register a HarnessModule.
 *
 * The module's manifest is automatically registered into the manifest store
 * (unless a manifest with the same id was already registered independently).
 * Throws if a module with the same manifest id is already registered.
 */
export function registerModule(mod: HarnessModule): void {
  const id = mod.manifest.id;

  if (modules.has(id)) {
    throw new Error(`Module "${id}" is already registered.`);
  }

  modules.set(id, mod);

  // Always store the module's manifest as authoritative.
  // If a manifest with the same id was registered independently
  // via registerManifest(), the module's version takes precedence.
  manifests.set(id, Object.freeze({ ...mod.manifest }));
}

/** Register multiple modules at once. */
export function registerModules(list: HarnessModule[]): void {
  for (const mod of list) {
    registerModule(mod);
  }
}

/** Get a registered module by manifest id. Returns undefined if not found. */
export function getModule(id: string): HarnessModule | undefined {
  return modules.get(id);
}

/** List all registered module ids (sorted). */
export function listModules(): string[] {
  return [...modules.keys()].sort();
}

/** Check whether a module with the given id is registered. */
export function hasModule(id: string): boolean {
  return modules.has(id);
}

// ── Query / Filter ────────────────────────────────────────────────────────────

/**
 * Find all manifests whose `coversTools` includes the given tool name.
 *
 * Use this to answer: "Which flows exercise `compress_context`?"
 */
export function findByCoveredTool(toolName: string): HarnessManifest[] {
  const results: HarnessManifest[] = [];
  for (const m of manifests.values()) {
    if (m.coversTools.includes(toolName)) {
      results.push(m);
    }
  }
  return results;
}

/**
 * Find all manifests that have the given tag.
 *
 * Use this to answer: "Show me all smoke-test flows."
 */
export function findByTag(tag: string): HarnessManifest[] {
  const results: HarnessManifest[] = [];
  for (const m of manifests.values()) {
    if (m.tags && m.tags.includes(tag)) {
      results.push(m);
    }
  }
  return results;
}

/**
 * Find all manifests that match the given capability.
 *
 * Use this to answer: "Show me all compression-related flows."
 */
export function findByCapability(capability: string): HarnessManifest[] {
  const results: HarnessManifest[] = [];
  for (const m of manifests.values()) {
    if (m.capability === capability) {
      results.push(m);
    }
  }
  return results;
}

// ── Clear ─────────────────────────────────────────────────────────────────────

/** Remove all registered manifests and modules (test helper). */
export function clearRegistry(): void {
  manifests.clear();
  modules.clear();
}

/** @deprecated Use `clearRegistry` instead. */
export const clearModules = clearRegistry;
