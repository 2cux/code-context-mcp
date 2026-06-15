/**
 * Manifest Registry Tests
 *
 * Covers: registerManifest, registerManifests, getManifest,
 * listManifests, listManifestDetails, clearRegistry.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerManifest,
  registerManifests,
  getManifest,
  listManifests,
  listManifestDetails,
  clearRegistry,
} from "../../src/harness/core/registry.js";
import type { Manifest } from "../../src/harness/core/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeManifest(name: string): Manifest {
  return {
    name,
    description: `Manifest ${name}`,
    loopType: "compression",
    steps: [{ name: "step1", description: "A step", expect: "success" }],
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearRegistry();
});

// ── Register ──────────────────────────────────────────────────────────────────

describe("registerManifest", () => {
  it("registers a manifest and retrieves it by name", () => {
    const m = makeManifest("test");
    registerManifest(m);
    expect(getManifest("test")).toEqual(m);
  });

  it("throws when registering a duplicate name", () => {
    registerManifest(makeManifest("test"));
    expect(() => registerManifest(makeManifest("test"))).toThrow(
      'Manifest "test" is already registered.',
    );
  });
});

describe("registerManifests", () => {
  it("registers multiple manifests at once", () => {
    registerManifests([makeManifest("a"), makeManifest("b"), makeManifest("c")]);
    expect(listManifests()).toEqual(["a", "b", "c"]);
  });
});

// ── Retrieve ──────────────────────────────────────────────────────────────────

describe("getManifest", () => {
  it("returns undefined for an unregistered name", () => {
    expect(getManifest("nonexistent")).toBeUndefined();
  });
});

describe("listManifests", () => {
  it("returns an empty array when nothing is registered", () => {
    expect(listManifests()).toEqual([]);
  });

  it("returns sorted names", () => {
    registerManifests([makeManifest("c"), makeManifest("a"), makeManifest("b")]);
    expect(listManifests()).toEqual(["a", "b", "c"]);
  });
});

describe("listManifestDetails", () => {
  it("returns full manifest objects", () => {
    registerManifest(makeManifest("test"));
    const details = listManifestDetails();
    expect(details).toHaveLength(1);
    expect(details[0]?.description).toBe("Manifest test");
  });
});

// ── Clear ─────────────────────────────────────────────────────────────────────

describe("clearRegistry", () => {
  it("removes all registered manifests", () => {
    registerManifest(makeManifest("test"));
    clearRegistry();
    expect(listManifests()).toEqual([]);
  });
});
