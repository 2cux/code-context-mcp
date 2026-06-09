/**
 * Input size validation.
 *
 * Enforces maxInputBytes. If content exceeds the limit, it's either
 * rejected or truncated depending on failOpen setting.
 *
 * Truncation is UTF-8 safe: uses TextEncoder/TextDecoder with the
 * { stream: true } option to avoid splitting multi-byte characters.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface SizeLimitConfig {
  maxInputBytes: number;
  failOpen: boolean;
}

export interface SizeCheckResult {
  ok: boolean;
  content: string;
  truncated: boolean;
  originalBytes: number;
  warning?: string;
}

export function checkSizeLimit(
  content: string,
  config: SizeLimitConfig,
): SizeCheckResult {
  const encoded = encoder.encode(content);
  const bytes = encoded.byteLength;

  if (bytes <= config.maxInputBytes) {
    return { ok: true, content, truncated: false, originalBytes: bytes };
  }

  if (config.failOpen) {
    // UTF-8-safe truncation: slice the Uint8Array at the byte boundary,
    // then use TextDecoder with { stream: true } so a trailing partial
    // multi-byte sequence is replaced with U+FFFD instead of throwing.
    const truncatedBytes = encoded.subarray(0, config.maxInputBytes);
    const truncated = decoder.decode(truncatedBytes, { stream: true });

    return {
      ok: true,
      content: truncated,
      truncated: true,
      originalBytes: bytes,
      warning: `Content truncated from ${bytes} to ${config.maxInputBytes} bytes`,
    };
  }

  return {
    ok: false,
    content,
    truncated: false,
    originalBytes: bytes,
    warning: `Content size ${bytes} exceeds limit ${config.maxInputBytes} bytes`,
  };
}
