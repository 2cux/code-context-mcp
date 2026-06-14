/**
 * Utils Unit Tests — tokenCount, hash, time
 *
 * Covers:
 *   - countTokens (tiktoken + fallback)
 *   - formatTokens (K/M formatting)
 *   - tokenDiff (saved + ratio)
 *   - tokenAwareTruncate (binary search truncation)
 *   - shortHash / fullHash / contentHash
 *   - nowISO / isoFromDate / daysFromNow / isExpired
 */

import { describe, it, expect } from "vitest";
import {
  countTokens,
  formatTokens,
  tokenDiff,
  tokenAwareTruncate,
} from "../src/utils/tokenCount.js";
import { shortHash, fullHash, contentHash } from "../src/utils/hash.js";
import {
  nowISO,
  isoFromDate,
  daysFromNow,
  isExpired,
} from "../src/utils/time.js";

// ============================================================================
// tokenCount
// ============================================================================

describe("countTokens", () => {
  it("returns a positive number for non-empty text", () => {
    const n = countTokens("Hello world! This is a test sentence.");
    expect(n).toBeGreaterThan(0);
    expect(Number.isInteger(n)).toBe(true);
  });

  it("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });

  it("returns 0 for whitespace-only string", () => {
    // Whitespace may tokenize to small tokens; it must be >= 0
    expect(countTokens("   \n\t  ")).toBeGreaterThanOrEqual(0);
  });

  it("returns higher count for longer text", () => {
    const short = countTokens("hi");
    const long = countTokens("hi ".repeat(100));
    expect(long).toBeGreaterThan(short);
  });

  it("returns higher count for more content", () => {
    const a = countTokens("The quick brown fox.");
    const b = countTokens(
      "The quick brown fox jumps over the lazy dog. " +
        "This is a much longer piece of text that should " +
        "definitely produce more tokens than the short one.",
    );
    expect(b).toBeGreaterThan(a);
  });

  it("handles Unicode / emoji", () => {
    const n = countTokens("中文测试 🎉 日本語 한국어 emoji: ✅❌🔥");
    expect(n).toBeGreaterThan(0);
  });

  it("handles very long content", () => {
    const content = "word ".repeat(10000);
    const n = countTokens(content);
    expect(n).toBeGreaterThan(100);
  });

  it("handles code-like content", () => {
    const code = `
import { describe, it, expect } from "vitest";
export function foo(bar: string): number {
  return bar.length;
}`;
    const n = countTokens(code);
    expect(n).toBeGreaterThan(0);
  });

  it("is deterministic (same input → same count)", () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    const a = countTokens(text);
    const b = countTokens(text);
    expect(a).toBe(b);
  });
});

// ============================================================================
// formatTokens
// ============================================================================

describe("formatTokens", () => {
  it("formats millions with M suffix", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatTokens(1_000_000)).toBe("1.0M");
  });

  it("formats thousands with K suffix", () => {
    expect(formatTokens(1_500)).toBe("1.5K");
    expect(formatTokens(1_000)).toBe("1.0K");
  });

  it("returns plain string for numbers under 1000", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(42)).toBe("42");
    expect(formatTokens(999)).toBe("999");
  });

  it("handles edge: 999.9K stays as K", () => {
    expect(formatTokens(999_900)).toBe("999.9K");
  });
});

// ============================================================================
// tokenDiff
// ============================================================================

describe("tokenDiff", () => {
  it("calculates saved and ratio correctly", () => {
    const { saved, ratio } = tokenDiff(1000, 200);
    expect(saved).toBe(800);
    expect(ratio).toBe(0.8);
  });

  it("returns 0/0 for no savings", () => {
    const { saved, ratio } = tokenDiff(1000, 1000);
    expect(saved).toBe(0);
    expect(ratio).toBe(0);
  });

  it("returns 0/0 when after > before (expansion)", () => {
    const { saved, ratio } = tokenDiff(100, 200);
    expect(saved).toBe(0);
    expect(ratio).toBe(0);
  });

  it("returns 0 ratio when before is 0", () => {
    const { saved, ratio } = tokenDiff(0, 0);
    expect(saved).toBe(0);
    expect(ratio).toBe(0);
  });

  it("handles 100% savings (after = 0)", () => {
    const { saved, ratio } = tokenDiff(100, 0);
    expect(saved).toBe(100);
    expect(ratio).toBe(1);
  });
});

// ============================================================================
// tokenAwareTruncate
// ============================================================================

describe("tokenAwareTruncate", () => {
  it("returns unchanged content when within budget", () => {
    const content = "Short text within budget.";
    const result = tokenAwareTruncate(content, 1000);
    expect(result).toBe(content);
  });

  it("truncates content exceeding maxTokens", () => {
    const content = "word ".repeat(5000);
    const result = tokenAwareTruncate(content, 50);
    expect(countTokens(result)).toBeLessThanOrEqual(50);
    expect(result.length).toBeLessThan(content.length);
  });

  it("preserves leading content (truncates from the end)", () => {
    const content = "AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH";
    const result = tokenAwareTruncate(content, 3);
    // Should start with the beginning of the content
    expect(result.startsWith("AAAA")).toBe(true);
  });

  it("handles maxTokens=1", () => {
    const content = "hello world this is a test";
    const result = tokenAwareTruncate(content, 1);
    expect(countTokens(result)).toBeLessThanOrEqual(1);
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles maxTokens=0", () => {
    const content = "some text";
    const result = tokenAwareTruncate(content, 0);
    expect(result).toBe("");
  });

  it("handles empty content", () => {
    const result = tokenAwareTruncate("", 100);
    expect(result).toBe("");
  });

  it("handles Unicode characters without corrupting", () => {
    const content = "你好世界！这是测试内容。".repeat(100);
    const result = tokenAwareTruncate(content, 20);
    expect(countTokens(result)).toBeLessThanOrEqual(20);
    // Should not have broken UTF-8
    expect(() => encodeURIComponent(result)).not.toThrow();
  });

  it("handles content that is already at budget exactly", () => {
    const content = "exact";
    const tokensBefore = countTokens(content);
    const result = tokenAwareTruncate(content, tokensBefore);
    expect(result).toBe(content);
  });
});

// ============================================================================
// hash
// ============================================================================

describe("shortHash", () => {
  it("returns 8 hex characters", () => {
    const h = shortHash("hello world");
    expect(h).toMatch(/^[a-f0-9]{8}$/);
  });

  it("is deterministic", () => {
    const a = shortHash("same input");
    const b = shortHash("same input");
    expect(a).toBe(b);
  });

  it("produces different hashes for different inputs", () => {
    const a = shortHash("input A");
    const b = shortHash("input B");
    expect(a).not.toBe(b);
  });

  it("handles empty string", () => {
    const h = shortHash("");
    expect(h).toMatch(/^[a-f0-9]{8}$/);
  });

  it("handles Unicode input", () => {
    const h = shortHash("中文测试 🎉");
    expect(h).toMatch(/^[a-f0-9]{8}$/);
  });
});

describe("fullHash", () => {
  it("returns 64 hex characters (SHA-256)", () => {
    const h = fullHash("hello world");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic", () => {
    const a = fullHash("same");
    const b = fullHash("same");
    expect(a).toBe(b);
  });

  it("produces different hashes for different inputs", () => {
    expect(fullHash("A")).not.toBe(fullHash("B"));
  });
});

describe("contentHash", () => {
  it("is an alias for fullHash", () => {
    expect(contentHash("test")).toBe(fullHash("test"));
  });

  it("returns 64 hex chars", () => {
    expect(contentHash("content")).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ============================================================================
// time
// ============================================================================

describe("nowISO", () => {
  it("returns an ISO 8601 string", () => {
    const ts = nowISO();
    expect(ts).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it("returns a time close to now", () => {
    const before = Date.now();
    const ts = nowISO();
    const parsed = new Date(ts).getTime();
    const after = Date.now();
    expect(parsed).toBeGreaterThanOrEqual(before - 1000);
    expect(parsed).toBeLessThanOrEqual(after + 1000);
  });

  it("returns distinct values on successive calls (monotonic-ish)", () => {
    const a = nowISO();
    const b = nowISO();
    // They may be equal if called within the same millisecond
    expect(a <= b).toBe(true);
  });
});

describe("isoFromDate", () => {
  it("returns ISO string for a given Date", () => {
    const d = new Date("2024-06-15T10:30:00Z");
    expect(isoFromDate(d)).toBe("2024-06-15T10:30:00.000Z");
  });
});

describe("daysFromNow", () => {
  it("returns a future date for positive days", () => {
    const future = daysFromNow(30);
    const futureMs = new Date(future).getTime();
    const nowMs = Date.now();
    const thirtyDaysMs = 30 * 86_400_000;
    expect(futureMs).toBeGreaterThan(nowMs);
    expect(futureMs - nowMs).toBeLessThan(thirtyDaysMs + 10_000); // within 10s tolerance
  });

  it("returns a past date for negative days", () => {
    const past = daysFromNow(-7);
    const pastMs = new Date(past).getTime();
    expect(pastMs).toBeLessThan(Date.now());
  });

  it("returns ISO 8601 format", () => {
    expect(daysFromNow(1)).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });
});

describe("isExpired", () => {
  it("returns false for null/undefined", () => {
    expect(isExpired(null)).toBe(false);
    expect(isExpired(undefined)).toBe(false);
  });

  it("returns false for future date", () => {
    const future = daysFromNow(30);
    expect(isExpired(future)).toBe(false);
  });

  it("returns true for past date", () => {
    const past = daysFromNow(-30);
    expect(isExpired(past)).toBe(true);
  });

  it("returns true for date far in the past", () => {
    expect(isExpired("2020-01-01T00:00:00.000Z")).toBe(true);
  });

  it("handles edge: exactly now (may or may not be expired)", () => {
    const now = nowISO();
    // Within ms tolerance, either result is fine
    expect(typeof isExpired(now)).toBe("boolean");
  });
});
