/**
 * Conversation History Compressor — Phase 4
 *
 * Preserves: user's current goal, completed steps, pending steps,
 * key decisions, recent errors, relevant file paths.
 * Folds: pleasantries, repeated explanations, low-value intermediate steps,
 * superseded context.
 */

import type { CompressionStrategy, StrategyResult } from "../compressionEngine.js";
import { countTokens } from "../../utils/tokenCount.js";

export const conversationHistoryStrategy: CompressionStrategy = {
  name: "conversation_history",
  version: "0.1.0",
  compress: compressConversationHistory,
};

// ---------------------------------------------------------------------------
// Legacy function export (backward-compatible)
// ---------------------------------------------------------------------------

export function compressConversationHistory(
  content: string,
  maxTokens: number,
): StrategyResult {
  // TODO: Phase 4
  const tokens = countTokens(content);
  if (tokens <= maxTokens) {
    return { compressedContent: content, warnings: [] };
  }
  return {
    compressedContent: content,
    warnings: [
      "Conversation history compression not yet implemented (Phase 4) — returned original",
    ],
    summary: "Conversation history compression stub — returning original",
  };
}
