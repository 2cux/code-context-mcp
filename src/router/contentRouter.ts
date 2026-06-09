/**
 * ContentRouter — Phase 2
 *
 * Detects content type and selects the appropriate compression strategy.
 * Supported types: test_output, log, command_output, code, json,
 * markdown, plain_text, rag_chunk, file_summary, conversation_history, unknown.
 */

export type ContentType =
  | "test_output"
  | "log"
  | "command_output"
  | "code"
  | "json"
  | "markdown"
  | "plain_text"
  | "rag_chunk"
  | "file_summary"
  | "conversation_history"
  | "unknown";

export interface DetectionResult {
  contentType: ContentType;
  confidence: number;
  signals: string[];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function detectContentType(content: string): DetectionResult {
  // TODO: Phase 2 — implement signal-based detection
  return {
    contentType: "unknown",
    confidence: 0,
    signals: [],
  };
}
