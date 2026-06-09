/**
 * Input size validation.
 *
 * Enforces maxInputBytes. If content exceeds the limit, it's either
 * rejected or truncated depending on failOpen setting.
 */

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
  const bytes = Buffer.byteLength(content, "utf-8");

  if (bytes <= config.maxInputBytes) {
    return { ok: true, content, truncated: false, originalBytes: bytes };
  }

  if (config.failOpen) {
    // Truncate to maxInputBytes and add a warning marker
    const truncated = Buffer.from(content, "utf-8")
      .subarray(0, config.maxInputBytes)
      .toString("utf-8");

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
