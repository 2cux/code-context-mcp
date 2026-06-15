/**
 * Check Utilities Tests
 *
 * Covers: checkEq, checkOk, checkString, checkNonEmptyString,
 * checkExists, checkRange, checkGt.
 */

import { describe, it, expect } from "vitest";
import {
  checkEq,
  checkOk,
  checkString,
  checkNonEmptyString,
  checkExists,
  checkRange,
  checkGt,
} from "../../src/harness/core/check.js";

// ── checkEq ───────────────────────────────────────────────────────────────────

describe("checkEq", () => {
  it("passes when values are equal", () => {
    expect(checkEq(42, 42, "answer")).toEqual({ outcome: "pass", message: "answer: OK" });
  });

  it("fails when values differ", () => {
    const result = checkEq(1, 2, "count");
    expect(result.outcome).toBe("fail");
    expect(result.message).toContain("expected 2, got 1");
  });
});

// ── checkOk ───────────────────────────────────────────────────────────────────

describe("checkOk", () => {
  it("passes for truthy values", () => {
    expect(checkOk(true, "flag").outcome).toBe("pass");
    expect(checkOk(1, "num").outcome).toBe("pass");
    expect(checkOk("hello", "str").outcome).toBe("pass");
  });

  it("fails for falsy values", () => {
    expect(checkOk(false, "flag").outcome).toBe("fail");
    expect(checkOk(0, "num").outcome).toBe("fail");
    expect(checkOk("", "str").outcome).toBe("fail");
  });
});

// ── checkString ───────────────────────────────────────────────────────────────

describe("checkString", () => {
  it("passes for string values", () => {
    expect(checkString("hello", "label").outcome).toBe("pass");
  });

  it("fails for non-string values", () => {
    expect(checkString(42, "label").outcome).toBe("fail");
    expect(checkString(null, "label").outcome).toBe("fail");
  });
});

// ── checkNonEmptyString ───────────────────────────────────────────────────────

describe("checkNonEmptyString", () => {
  it("passes for non-empty strings", () => {
    expect(checkNonEmptyString("hello", "label").outcome).toBe("pass");
  });

  it("fails for empty strings", () => {
    expect(checkNonEmptyString("", "label").outcome).toBe("fail");
  });

  it("fails for whitespace-only strings", () => {
    expect(checkNonEmptyString("   ", "label").outcome).toBe("fail");
  });
});

// ── checkExists ───────────────────────────────────────────────────────────────

describe("checkExists", () => {
  it("passes for non-null, non-undefined values", () => {
    expect(checkExists("hello", "label").outcome).toBe("pass");
    expect(checkExists(0, "label").outcome).toBe("pass");
    expect(checkExists(false, "label").outcome).toBe("pass");
  });

  it("fails for null and undefined", () => {
    expect(checkExists(null, "label").outcome).toBe("fail");
    expect(checkExists(undefined, "label").outcome).toBe("fail");
  });
});

// ── checkRange ────────────────────────────────────────────────────────────────

describe("checkRange", () => {
  it("passes when value is within range", () => {
    expect(checkRange(5, 1, 10, "val").outcome).toBe("pass");
    expect(checkRange(1, 1, 10, "val").outcome).toBe("pass");
    expect(checkRange(10, 1, 10, "val").outcome).toBe("pass");
  });

  it("fails when value is outside range", () => {
    expect(checkRange(0, 1, 10, "val").outcome).toBe("fail");
    expect(checkRange(11, 1, 10, "val").outcome).toBe("fail");
  });
});

// ── checkGt ───────────────────────────────────────────────────────────────────

describe("checkGt", () => {
  it("passes when value is greater than threshold", () => {
    expect(checkGt(10, 5, "val").outcome).toBe("pass");
  });

  it("fails when value is equal to or less than threshold", () => {
    expect(checkGt(5, 5, "val").outcome).toBe("fail");
    expect(checkGt(3, 5, "val").outcome).toBe("fail");
  });
});
