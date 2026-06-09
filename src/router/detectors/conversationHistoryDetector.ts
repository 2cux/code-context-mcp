/**
 * Conversation History Detector — Phase 2
 *
 * Detects LLM / chat conversation history.
 * Signals: role-based message markers (JSON chat format, Human/Assistant prefixes,
 * User/AI turn markers, system messages).
 */

import type { DetectionResult } from "../contentRouter.js";
import { computeConfidence, matchSignals } from "../contentRouter.js";

// ---------------------------------------------------------------------------
// Signal patterns
// ---------------------------------------------------------------------------

const SIGNALS: Record<string, RegExp> = {
  "role field": /"role"\s*:/,
  "content field": /"content"\s*:/,
  "user:": /(?:^|\n)user\s*:/im,
  "assistant:": /(?:^|\n)(?:assistant|ai|bot)\s*:/im,
  "system:": /(?:^|\n)system\s*:/im,
  "human:": /(?:^|\n)human\s*:/im,
  "messages array": /"messages"\s*:/,
  conversation: /\bconversation\b/i,
  "turn marker": /^={3,}\s*(?:turn|step|message|round)/im,
};

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export function detectConversationHistory(content: string): DetectionResult | null {
  const signals = matchSignals(content, SIGNALS);
  if (signals.length === 0) return null;

  // Conversation history needs at least 2 signals to be plausible
  const confidence = computeConfidence(signals.length, Object.keys(SIGNALS).length, {
    minMatches: 2,
  });

  if (confidence < 0.2) return null;

  return {
    contentType: "conversation_history",
    confidence,
    signals,
  };
}
