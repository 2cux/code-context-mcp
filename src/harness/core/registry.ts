/**
 * Manifest Registry
 *
 * Stores and retrieves HarnessManifests. Each manifest declares a
 * business-capability closed loop. The registry is the single source
 * of truth for which manifests are available.
 *
 * For module registration (manifest + execution logic), use the
 * HarnessModule registry in runner.ts (`registerModule`).
 *
 * PRD §34: Manifest 声明要执行哪个闭环，不声明具体工具调用序列。
 */

import type { HarnessManifest } from "./types.js";

// ── Registry State ────────────────────────────────────────────────────────────

const manifests = new Map<string, HarnessManifest>();

// ── Register ──────────────────────────────────────────────────────────────────

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

// ── Retrieve ──────────────────────────────────────────────────────────────────

/** Get a manifest by id. Returns undefined if not found. */
export function getManifest(id: string): HarnessManifest | undefined {
  return manifests.get(id);
}

/** List all registered manifest ids. */
export function listManifests(): string[] {
  return [...manifests.keys()].sort();
}

/** List all registered manifests with full details. */
export function listManifestDetails(): HarnessManifest[] {
  return [...manifests.values()];
}

// ── Clear ─────────────────────────────────────────────────────────────────────

/** Remove all registered manifests (test helper). */
export function clearRegistry(): void {
  manifests.clear();
}
