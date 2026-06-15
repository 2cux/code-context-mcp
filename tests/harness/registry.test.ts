/**
 * HarnessRegistry Tests
 *
 * Covers: registerManifest, registerManifests, getManifest,
 * listManifests, listManifestDetails, registerModule, registerModules,
 * getModule, listModules, hasModule, findByCoveredTool, findByTag,
 * findByCapability, clearRegistry.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerManifest,
  registerManifests,
  getManifest,
  listManifests,
  listManifestDetails,
  registerModule,
  registerModules,
  getModule,
  listModules,
  hasModule,
  findByCoveredTool,
  findByTag,
  findByCapability,
  clearRegistry,
} from "../../src/harness/core/registry.js";
import type { HarnessManifest, HarnessModule } from "../../src/harness/core/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeManifest(id: string, overrides?: Partial<HarnessManifest>): HarnessManifest {
  return {
    id,
    name: `Manifest ${id}`,
    description: `Description for ${id}`,
    phases: [{ name: "main", description: "Main phase" }],
    checkpoints: [{ name: "step1", description: "A step", expect: "pass" }],
    artifacts: [],
    coversTools: [],
    tags: [],
    capability: undefined,
    ...overrides,
  };
}

function makeModule(
  id: string,
  overrides?: Partial<HarnessManifest>,
): HarnessModule {
  return {
    manifest: makeManifest(id, overrides),
    run: async () => ({ checked: 1 }),
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearRegistry();
});

// ── Manifest Operations ───────────────────────────────────────────────────────

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

// ── Module Operations ─────────────────────────────────────────────────────────

describe("registerModule", () => {
  it("registers a module and retrieves it by id", () => {
    const mod = makeModule("test-flow");
    registerModule(mod);
    expect(getModule("test-flow")).toBe(mod);
  });

  it("auto-registers the manifest when registering a module", () => {
    const mod = makeModule("test-flow");
    registerModule(mod);
    // Manifest should be automatically registered
    expect(getManifest("test-flow")).toBeDefined();
    expect(getManifest("test-flow")?.id).toBe("test-flow");
  });

  it("throws when registering a duplicate module id", () => {
    registerModule(makeModule("test-flow"));
    expect(() => registerModule(makeModule("test-flow"))).toThrow(
      'Module "test-flow" is already registered.',
    );
  });

  it("module manifest takes precedence over independently-registered manifest", () => {
    // Register a manifest with one set of tools
    registerManifest(makeManifest("test-flow", {
      coversTools: ["old_tool"],
      tags: ["old-tag"],
    }));
    // Register a module with a different manifest for the same id
    const mod = makeModule("test-flow", {
      coversTools: ["new_tool"],
      tags: ["new-tag"],
    });
    registerModule(mod);

    // The manifest store should now reflect the module's manifest (authoritative)
    const m = getManifest("test-flow");
    expect(m?.coversTools).toEqual(["new_tool"]);
    expect(m?.tags).toEqual(["new-tag"]);
  });
});

describe("registerModules", () => {
  it("registers multiple modules at once", () => {
    registerModules([
      makeModule("a"),
      makeModule("b"),
      makeModule("c"),
    ]);
    expect(listModules()).toEqual(["a", "b", "c"]);
    // Manifests should also be auto-registered
    expect(listManifests()).toEqual(["a", "b", "c"]);
  });
});

describe("getModule", () => {
  it("returns undefined for an unregistered id", () => {
    expect(getModule("nonexistent")).toBeUndefined();
  });
});

describe("listModules", () => {
  it("returns an empty array when nothing is registered", () => {
    expect(listModules()).toEqual([]);
  });

  it("returns sorted ids", () => {
    registerModules([
      makeModule("c"),
      makeModule("a"),
      makeModule("b"),
    ]);
    expect(listModules()).toEqual(["a", "b", "c"]);
  });
});

describe("hasModule", () => {
  it("returns true for a registered module", () => {
    registerModule(makeModule("test-flow"));
    expect(hasModule("test-flow")).toBe(true);
  });

  it("returns false for an unregistered module", () => {
    expect(hasModule("nonexistent")).toBe(false);
  });
});

// ── Query / Filter ────────────────────────────────────────────────────────────

describe("findByCoveredTool", () => {
  it("returns manifests that cover a given tool", () => {
    registerManifests([
      makeManifest("flow-a", {
        coversTools: ["compress_context", "retrieve_original"],
      }),
      makeManifest("flow-b", {
        coversTools: ["remember_context", "recall_context"],
      }),
      makeManifest("flow-c", {
        coversTools: ["compress_context", "list_compressions"],
      }),
    ]);

    const results = findByCoveredTool("compress_context");
    expect(results).toHaveLength(2);
    expect(results.map((m) => m.id).sort()).toEqual(["flow-a", "flow-c"]);
  });

  it("returns an empty array when no manifest covers the tool", () => {
    registerManifest(makeManifest("flow-a", {
      coversTools: ["remember_context"],
    }));
    expect(findByCoveredTool("nonexistent_tool")).toEqual([]);
  });

  it("returns an empty array when registry is empty", () => {
    expect(findByCoveredTool("compress_context")).toEqual([]);
  });
});

describe("findByTag", () => {
  it("returns manifests that have a given tag", () => {
    registerManifests([
      makeManifest("flow-a", { tags: ["smoke", "acceptance"] }),
      makeManifest("flow-b", { tags: ["acceptance", "mcp"] }),
      makeManifest("flow-c", { tags: ["cli"] }),
    ]);

    const results = findByTag("smoke");
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("flow-a");
  });

  it("returns multiple manifests when tag matches many", () => {
    registerManifests([
      makeManifest("flow-a", { tags: ["acceptance"] }),
      makeManifest("flow-b", { tags: ["acceptance", "mcp"] }),
    ]);

    expect(findByTag("acceptance")).toHaveLength(2);
  });

  it("returns an empty array when no manifest has the tag", () => {
    registerManifest(makeManifest("flow-a", { tags: ["cli"] }));
    expect(findByTag("nonexistent")).toEqual([]);
  });

  it("returns an empty array when manifest has no tags", () => {
    registerManifest(makeManifest("flow-a")); // no tags
    expect(findByTag("smoke")).toEqual([]);
  });
});

describe("findByCapability", () => {
  it("returns manifests that match a given capability", () => {
    registerManifests([
      makeManifest("flow-a", { capability: "compression" }),
      makeManifest("flow-b", { capability: "memory" }),
      makeManifest("flow-c", { capability: "compression" }),
    ]);

    const results = findByCapability("compression");
    expect(results).toHaveLength(2);
    expect(results.map((m) => m.id).sort()).toEqual(["flow-a", "flow-c"]);
  });

  it("returns an empty array when no manifest matches the capability", () => {
    registerManifest(makeManifest("flow-a", { capability: "memory" }));
    expect(findByCapability("compression")).toEqual([]);
  });

  it("returns an empty array when manifest has no capability", () => {
    registerManifest(makeManifest("flow-a")); // no capability
    expect(findByCapability("compression")).toEqual([]);
  });
});

// ── Clear ─────────────────────────────────────────────────────────────────────

describe("clearRegistry", () => {
  it("removes all registered manifests and modules", () => {
    registerManifest(makeManifest("manifest-only"));
    registerModule(makeModule("module-flow"));
    clearRegistry();
    expect(listManifests()).toEqual([]);
    expect(listModules()).toEqual([]);
  });
});
