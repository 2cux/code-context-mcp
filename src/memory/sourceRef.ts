/**
 * Source Reference — Normalization & Helpers
 *
 * Standardizes sourceRef formats for linking memories to their origin:
 *   user:manual    — user explicitly provided the memory
 *   file:<path>    — memory derived from a project file
 *   ccr:<id>       — memory derived from a compressed context record
 *   orig:<id>      — memory linked to an original content record
 *   command:<cmd>  — memory derived from a CLI command execution
 *
 * Design principles:
 *   - All sourceRef values should follow one of these patterns.
 *   - Parsing is lenient (fail-open): unrecognized formats pass through.
 *   - Backward compatible: free-form strings remain valid as "legacy" refs.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SourceRefPrefix = "user" | "file" | "ccr" | "orig" | "command";

export interface ParsedSourceRef {
  /** The prefix, e.g. "ccr" */
  prefix: SourceRefPrefix;
  /** The value after the colon, e.g. "ccr_abc123" */
  value: string;
}

export interface ParsedSourceRefUnknown {
  /** The prefix, or "unknown" for unrecognized formats */
  prefix: SourceRefPrefix | "unknown";
  /** The raw sourceRef string */
  value: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All recognized sourceRef prefixes. */
export const SOURCE_REF_PREFIXES: ReadonlyArray<SourceRefPrefix> = [
  "user",
  "file",
  "ccr",
  "orig",
  "command",
] as const;

/** Prefix separator. */
const SEPARATOR = ":";

// ---------------------------------------------------------------------------
// Constructors — build a standardized sourceRef string
// ---------------------------------------------------------------------------

/** sourceRef = "user:manual" */
export function userManualRef(): string {
  return `user${SEPARATOR}manual`;
}

/** sourceRef = "file:<path>" */
export function fileRef(path: string): string {
  return `file${SEPARATOR}${path}`;
}

/** sourceRef = "ccr:<id>" */
export function ccrRef(ccrId: string): string {
  return `ccr${SEPARATOR}${ccrId}`;
}

/** sourceRef = "orig:<id>" */
export function origRef(originalId: string): string {
  return `orig${SEPARATOR}${originalId}`;
}

/** sourceRef = "command:<cmd>" */
export function commandRef(command: string): string {
  return `command${SEPARATOR}${command}`;
}

// ---------------------------------------------------------------------------
// Parser — extract prefix and value
// ---------------------------------------------------------------------------

/**
 * Parse a sourceRef string into its prefix and value.
 *
 * Recognized format: "prefix:value"
 * When the prefix matches a known SourceRefPrefix, returns a typed result.
 * When the prefix is unknown or the string has no colon, returns prefix="unknown"
 * with the full string as value.
 *
 * Always returns an object — never throws (fail-open).
 */
export function parseSourceRef(raw: string): ParsedSourceRef | ParsedSourceRefUnknown {
  // Guard against empty / whitespace-only strings
  if (!raw || !raw.trim()) {
    return { prefix: "unknown", value: raw ?? "" };
  }

  const trimmed = raw.trim();
  const colonIdx = trimmed.indexOf(SEPARATOR);

  // No colon — treat entire string as value with "unknown" prefix
  if (colonIdx === -1) {
    return { prefix: "unknown", value: trimmed };
  }

  const prefixPart = trimmed.substring(0, colonIdx);
  const valuePart = trimmed.substring(colonIdx + 1);

  // Check if prefix is recognized
  if (isSourceRefPrefix(prefixPart)) {
    return { prefix: prefixPart, value: valuePart };
  }

  return { prefix: "unknown", value: trimmed };
}

/**
 * Check whether a sourceRef matches one of the recognized patterns.
 * This is a structural check — it does not validate that the referenced
 * entity (ccr, orig, file, etc.) actually exists.
 */
export function isRecognizedSourceRef(raw: string): boolean {
  const parsed = parseSourceRef(raw);
  return parsed.prefix !== "unknown";
}

/**
 * Check whether a sourceRef looks like a ccr:<id> reference.
 */
export function isCcrRef(raw: string): boolean {
  const parsed = parseSourceRef(raw);
  return parsed.prefix === "ccr";
}

/**
 * Check whether a sourceRef looks like an orig:<id> reference.
 */
export function isOrigRef(raw: string): boolean {
  const parsed = parseSourceRef(raw);
  return parsed.prefix === "orig";
}

/**
 * Check whether a sourceRef looks like a file:<path> reference.
 */
export function isFileRef(raw: string): boolean {
  const parsed = parseSourceRef(raw);
  return parsed.prefix === "file";
}

/**
 * Check whether a sourceRef looks like a command:<cmd> reference.
 */
export function isCommandRef(raw: string): boolean {
  const parsed = parseSourceRef(raw);
  return parsed.prefix === "command";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSourceRefPrefix(value: string): value is SourceRefPrefix {
  return (SOURCE_REF_PREFIXES as ReadonlyArray<string>).includes(value);
}
