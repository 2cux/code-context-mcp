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
import type { HarnessManifest } from "../../src/harness/core/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeManifest(id: string): HarnessManifest {
  return {
    id,
    name: `Manifest ${id}`,
    description: `Description for ${id}`,
    phases: [{ name: "main", description: "Main phase" }],
    checkpoints: [{ name: "step1", description: "A step", expect: "pass" }],
    artifacts: [],
    coversTools: [],
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearRegistry();
});

// ── Register ──────────────────────────────────────────────────────────────────

describe("registerManifest", () => {
  it("registers a manifest and retrieves it by id", () => {
    const m = makeManifest("test-flow");
    registerManifest(m);
    expect(getManifest("test-flow")).toEqual(m);
  });

  it("throws when registering a duplicate id", () => {
    registerManifest(makeManifest("test-flow"));
    expect(() => registerManifest(makeManifest("test-flow"))).toThrow(
      'Manifest "test-flow" is already registered.',
    );
  });
});

describe("registerManifests", () => {
  it("registers multiple manifests at once", () => {
    registerManifests([
      makeManifest("a"),
      makeManifest("b"),
      makeManifest("c"),
    ]);
    expect(listManifests()).toEqual(["a", "b", "c"]);
  });
});

// ── Retrieve ──────────────────────────────────────────────────────────────────

describe("getManifest", () => {
  it("returns undefined for an unregistered id", () => {
    expect(getManifest("nonexistent")).toBeUndefined();
  });
});

describe("listManifests", () => {
  it("returns an empty array when nothing is registered", () => {
    expect(listManifests()).toEqual([]);
  });

  it("returns sorted ids", () => {
    registerManifests([
      makeManifest("c"),
      makeManifest("a"),
      makeManifest("b"),
    ]);
    expect(listManifests()).toEqual(["a", "b", "c"]);
  });
});

describe("listManifestDetails", () => {
  it("returns full manifest objects", () => {
    registerManifest(makeManifest("test-flow"));
    const details = listManifestDetails();
    expect(details).toHaveLength(1);
    expect(details[0]?.description).toBe("Description for test-flow");
  });
});

// ── Clear ─────────────────────────────────────────────────────────────────────

describe("clearRegistry", () => {
  it("removes all registered manifests", () => {
    registerManifest(makeManifest("test-flow"));
    clearRegistry();
    expect(listManifests()).toEqual([]);
  });
});
