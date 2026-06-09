/**
 * Input size validation — PRD §11.2 Size Limit
 *
 * Enforces maxInputBytes on all compression inputs.
 *
 * Two modes:
 *   failOpen = true  → truncate content (UTF-8 safe), return warning
 *   failOpen = false → reject content, return error
 *
 * Truncation is UTF-8 safe: uses TextEncoder/TextDecoder with the
 * { stream: true } option to avoid splitting multi-byte characters.
 *
 * Design principles (PRD §7.6):
 *   - Content exceeding the limit must trigger chunking or rejection.
 *   - A clear warning must be returned.
 *   - The event must be recorded in a receipt.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SizeLimitConfig {
  /** Maximum allowed bytes (PRD §18 default: 1048576 = 1MB) */
  maxInputBytes: number;
  /**
   * When true, oversized content is truncated rather than rejected.
   * When false, oversized content causes a rejection.
   * PRD §18 default: true
   */
  failOpen: boolean;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface SizeCheckResult {
  /** Whether the content passed the check (ok=true, reject=false). */
  ok: boolean;
  /** The (possibly truncated) content to use downstream. */
  content: string;
  /** Whether truncation was applied. */
  truncated: boolean;
  /** Original byte size before any truncation. */
  originalBytes: number;
  /** Byte size after truncation (equal to originalBytes when not truncated). */
  resultingBytes: number;
  /** Human-readable warning or error message. */
  warning?: string;
  /** Code for the warning / error, for receipt recording. */
  code?: "size_ok" | "size_truncated" | "size_rejected";
}

// ---------------------------------------------------------------------------
// Defaults (PRD §18)
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_INPUT_BYTES = 1_048_576; // 1MB

// ---------------------------------------------------------------------------
// Core function
// ---------------------------------------------------------------------------

/**
 * Validate input content against the maxInputBytes limit.
 *
 * When the content fits, returns it unchanged.
 * When it exceeds the limit and failOpen is true, truncates safely.
 * When it exceeds the limit and failOpen is false, rejects with an error.
 *
 * @param content - Raw input content to check.
 * @param config  - Size limit configuration (maxInputBytes + failOpen).
 * @returns A SizeCheckResult indicating pass / truncate / reject.
 */
export function checkSizeLimit(
  content: string,
  config: SizeLimitConfig,
): SizeCheckResult {
  const encoded = encoder.encode(content);
  const bytes = encoded.byteLength;

  // Content fits — pass through
  if (bytes <= config.maxInputBytes) {
    return {
      ok: true,
      content,
      truncated: false,
      originalBytes: bytes,
      resultingBytes: bytes,
      code: "size_ok",
    };
  }

  // Content exceeds limit

  if (config.failOpen) {
    // UTF-8-safe truncation: slice at byte boundary, decode with
    // { stream: true } so trailing partial multi-byte sequences are
    // replaced with U+FFFD instead of throwing.
    const truncatedBytes = encoded.subarray(0, config.maxInputBytes);
    const truncated = decoder.decode(truncatedBytes, { stream: true });

    return {
      ok: true,
      content: truncated,
      truncated: true,
      originalBytes: bytes,
      resultingBytes: truncatedBytes.byteLength,
      warning: `Content truncated from ${formatBytes(bytes)} to ${formatBytes(config.maxInputBytes)} (limit). Consider using chunking for large inputs.`,
      code: "size_truncated",
    };
  }

  // failOpen = false — reject
  return {
    ok: false,
    content,
    truncated: false,
    originalBytes: bytes,
    resultingBytes: bytes,
    warning: `Content size ${formatBytes(bytes)} exceeds limit of ${formatBytes(config.maxInputBytes)}. Rejected.`,
    code: "size_rejected",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)}MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)}KB`;
  return `${n}B`;
}

/**
 * Return the default size-limit config per PRD §18.
 */
export function defaultSizeLimitConfig(): SizeLimitConfig {
  return {
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    failOpen: true,
  };
}
