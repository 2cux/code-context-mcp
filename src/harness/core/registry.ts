/**
 * Manifest Registry
 *
 * Stores and retrieves Manifests. Each manifest declares a business-capability
 * closed loop. The registry is the single source of truth for which manifests
 * are available and valid.
 *
 * PRD §34: Manifest 声明要执行哪个闭环，不声明具体工具调用序列。
 */

import type { Manifest } from "./types.js";

// ── Registry State ────────────────────────────────────────────────────────────

const manifests = new Map<string, Manifest>();

// ── Register ──────────────────────────────────────────────────────────────────

/** Register a manifest. Throws if a manifest with the same name is already registered. */
export function registerManifest(manifest: Manifest): void {
  if (manifests.has(manifest.name)) {
    throw new Error(`Manifest "${manifest.name}" is already registered.`);
  }
  manifests.set(manifest.name, Object.freeze({ ...manifest }));
}

/** Register multiple manifests at once. */
export function registerManifests(list: Manifest[]): void {
  for (const m of list) {
    registerManifest(m);
  }
}

// ── Retrieve ──────────────────────────────────────────────────────────────────

/** Get a manifest by name. Returns undefined if not found. */
export function getManifest(name: string): Manifest | undefined {
  return manifests.get(name);
}

/** List all registered manifest names. */
export function listManifests(): string[] {
  return [...manifests.keys()].sort();
}

/** List all registered manifests with full details. */
export function listManifestDetails(): Manifest[] {
  return [...manifests.values()];
}

// ── Clear ─────────────────────────────────────────────────────────────────────

/** Remove all registered manifests (test helper). */
export function clearRegistry(): void {
  manifests.clear();
}
