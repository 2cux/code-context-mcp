/**
 * Error Serialization
 *
 * Converts thrown values (Error, string, unknown) into a stable,
 * JSON-safe shape for checkpoint messages and run records.
 *
 * PRD §34: 错误序列化工具。
 */

// ── Serialized Error Shape ────────────────────────────────────────────────────

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError | null;
}

// ── Serialize ─────────────────────────────────────────────────────────────────

/** Convert any thrown value into a SerializedError. */
export function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      cause: err.cause ? serializeError(err.cause) : null,
    };
  }

  if (typeof err === "string") {
    return { name: "Error", message: err };
  }

  // Fallback: stringify whatever was thrown
  try {
    return { name: "Error", message: JSON.stringify(err) };
  } catch {
    return { name: "Error", message: String(err) };
  }
}

// ── Format ────────────────────────────────────────────────────────────────────

/** Format a serialized error as a single-line string for checkpoint messages. */
export function formatError(err: unknown): string {
  const s = serializeError(err);
  let msg = `${s.name}: ${s.message}`;
  if (s.cause) {
    msg += ` [cause: ${s.cause.name}: ${s.cause.message}]`;
  }
  return msg;
}
