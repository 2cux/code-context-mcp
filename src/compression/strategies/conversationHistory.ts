/**
 * Conversation History Compressor — Phase 4 (Full Implementation)
 *
 * Preserves: user's current goal, completed steps, pending steps,
 * key decisions, recent errors, relevant file paths.
 * Folds: pleasantries, repeated explanations, low-value intermediate steps,
 * superseded context.
 */

import type { CompressionStrategy, StrategyResult } from "../compressionEngine.js";
import { countTokens, tokenAwareTruncate } from "../../utils/tokenCount.js";

export const conversationHistoryStrategy: CompressionStrategy = {
  name: "conversation_history",
  version: "1.0.0",
  compress: compressConversationHistory,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConversationMessage {
  role: string;
  content: string;
  score: number;
}

interface ExtractedConversation {
  goal: string;
  completedSteps: string[];
  pendingSteps: string[];
  keyDecisions: string[];
  recentErrors: string[];
  relevantFiles: string[];
  highValueMessages: ConversationMessage[];
  foldedCount: number;
  totalMessages: number;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const PLEASANTRY_PATTERNS = /\b(?:hi|hello|hey|thanks|thank you|you'?re welcome|great|awesome|cool|okay|sure|got it|no problem|np)\b/i;
const DECISION_PATTERNS = /\b(?:decided|decision|agreed|chose|opted|settled on|going to go with|we will|we should|let'?s go with)\b/i;
const ERROR_PATTERNS = /\b(?:error|Error|ERROR|fail|FAIL|exception|Exception|crash|bug|Bug|broken)\b/;
const FILE_PATH_RE = /\b(?:src|lib|tests?|docs?|app|components?|utils?|services?|configs?)\/[\w./-]+\.[\w]{1,6}\b/g;
const CHECKLIST_DONE_RE = /^\s*(?:-\s*\[x\]|✓|✅|✔️|done:)\s*(.+)/im;
const CHECKLIST_TODO_RE = /^\s*(?:-\s*\[\s\]|⬜|⭕|todo:)\s*(.+)/im;

// ---------------------------------------------------------------------------
// Export (backward-compatible)
// ---------------------------------------------------------------------------

export function compressConversationHistory(
  content: string,
  maxTokens: number,
): StrategyResult {
  const warnings: string[] = [];
  const tokens = countTokens(content);

  if (!content || content.trim().length === 0) {
    return { compressedContent: content, warnings, summary: "Empty conversation history" };
  }

  if (tokens <= maxTokens) {
    return { compressedContent: content, warnings, summary: "Conversation fits within token budget" };
  }

  try {
    const messages = parseMessages(content);
    const extracted = extractConversationInfo(messages, content);

    const parts = buildCompressedOutput(extracted);

    let result = parts.join("\n");
    let resultTokens = countTokens(result);

    if (resultTokens <= maxTokens) {
      return {
        compressedContent: result,
        warnings,
        summary: `Conversation compressed: ${extracted.highValueMessages.length}/${extracted.totalMessages} messages kept`,
      };
    }

    result = trimConversationOutput(extracted, maxTokens);
    warnings.push("Trimmed conversation output to fit token budget");

    return {
      compressedContent: result,
      warnings,
      summary: `Conversation compressed and trimmed`,
    };
  } catch {
    return truncateFallback(content, maxTokens, warnings);
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseMessages(content: string): ConversationMessage[] {
  const messages: ConversationMessage[] = [];

  // Try JSON first
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.messages && Array.isArray(parsed.messages)) {
        for (const msg of parsed.messages) {
          messages.push({
            role: msg.role ?? "unknown",
            content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
            score: 0,
          });
        }
        // Also extract metadata fields
        if (parsed.goal) {
          messages.unshift({ role: "system", content: `Goal: ${parsed.goal}`, score: 100 });
        }
        if (parsed.completedSteps) {
          messages.push({ role: "system", content: `Completed: ${JSON.stringify(parsed.completedSteps)}`, score: 80 });
        }
        if (parsed.pendingSteps) {
          messages.push({ role: "system", content: `Pending: ${JSON.stringify(parsed.pendingSteps)}`, score: 80 });
        }
        if (parsed.keyDecisions) {
          messages.push({ role: "system", content: `Decisions: ${JSON.stringify(parsed.keyDecisions)}`, score: 85 });
        }
        return scoreMessages(messages);
      }
    } catch {
      // Fall through to text parsing
    }
  }

  // Text-based parsing: <role> tokens
  const roleRegex = /<(?:user|assistant|system|tool)>/i;
  const lines = trimmed.split("\n");
  let currentRole = "unknown";
  let currentContent: string[] = [];

  for (const line of lines) {
    const roleMatch = line.match(roleRegex);
    if (roleMatch) {
      // Save previous message
      if (currentContent.length > 0) {
        messages.push({
          role: currentRole,
          content: currentContent.join("\n").trim(),
          score: 0,
        });
      }
      currentRole = roleMatch[0]!.replace(/[<>]/g, "").toLowerCase();
      currentContent = [line.replace(roleRegex, "").trim()].filter(Boolean);
    } else {
      currentContent.push(line);
    }
  }
  // Don't forget last message
  if (currentContent.length > 0) {
    messages.push({
      role: currentRole,
      content: currentContent.join("\n").trim(),
      score: 0,
    });
  }

  // If no structured messages found, treat as plain text
  if (messages.length === 0) {
    messages.push({
      role: "conversation",
      content: trimmed.slice(0, 2000),
      score: 0,
    });
  }

  return scoreMessages(messages);
}

function scoreMessages(messages: ConversationMessage[]): ConversationMessage[] {
  return messages.map((msg, idx) => {
    let score = 10; // Base score

    // Role-based
    if (msg.role === "system") score += 30;
    if (msg.role === "user" && idx === 0) score += 40; // First user message = goal

    // Content-based
    const content = msg.content;

    // Goal indicators
    if (/\b(?:goal|objective|task|need to|want to|fix|implement|build|create|add|remove|change|update)\b/i.test(content)) {
      score += 30;
    }

    // Decision indicators
    if (DECISION_PATTERNS.test(content)) {
      score += 25;
    }

    // Error indicators
    if (ERROR_PATTERNS.test(content)) {
      score += 20;
    }

    // File references
    if (FILE_PATH_RE.test(content)) {
      score += 15;
    }

    // Code blocks (technical content)
    if (content.includes("```")) {
      score += 15;
    }

    // Checklist items
    if (CHECKLIST_DONE_RE.test(content) || CHECKLIST_TODO_RE.test(content)) {
      score += 20;
    }

    // Low-value penalty
    const trimmed = content.trim();
    if (PLEASANTRY_PATTERNS.test(trimmed) && trimmed.length < 100) {
      score -= 15;
    }
    if (trimmed.length < 20 && !/error|fail|goal|decision/i.test(trimmed)) {
      score -= 20;
    }
    if (trimmed.length > 1000) {
      score -= 10; // Very long messages
    }

    // Recent messages get a slight boost
    const recencyBonus = Math.min(15, Math.floor(idx / Math.max(messages.length, 1) * 15));
    score += recencyBonus;

    return { ...msg, score: Math.max(0, score) };
  });
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function extractConversationInfo(
  messages: ConversationMessage[],
  fullContent: string,
): ExtractedConversation {
  // Goal: first user message
  const firstUser = messages.find((m) => m.role === "user");
  const goal = firstUser?.content.slice(0, 200) ?? "(not detected)";

  // Completed steps
  const completedSteps: string[] = [];
  for (const msg of messages) {
    const matches = msg.content.matchAll(new RegExp(CHECKLIST_DONE_RE.source, "gm"));
    for (const m of matches) {
      completedSteps.push((m[1] ?? m[0]!).trim());
    }
  }

  // Pending steps
  const pendingSteps: string[] = [];
  for (const msg of messages) {
    const matches = msg.content.matchAll(new RegExp(CHECKLIST_TODO_RE.source, "gm"));
    for (const m of matches) {
      pendingSteps.push((m[1] ?? m[0]!).trim());
    }
  }

  // Key decisions (messages with decision keywords)
  const keyDecisions: string[] = [];
  for (const msg of messages) {
    if (DECISION_PATTERNS.test(msg.content)) {
      const lines = msg.content.split(/(?:[.;]\s+|\n)/);
      for (const line of lines) {
        if (DECISION_PATTERNS.test(line) && line.length > 20 && line.length < 300) {
          keyDecisions.push(line.trim());
        }
      }
    }
  }

  // Recent errors (last 5 messages with errors)
  const errorMessages = messages.filter((m) => ERROR_PATTERNS.test(m.content));
  const recentErrors = errorMessages.slice(-3).map((m) => {
    const trimmed = m.content.trim();
    return trimmed.length > 200 ? trimmed.slice(0, 197) + "..." : trimmed;
  });

  // Relevant files
  const fileSet = new Set<string>();
  for (const msg of messages) {
    const matches = msg.content.matchAll(FILE_PATH_RE);
    for (const m of matches) {
      fileSet.add(m[0]);
    }
  }
  // Also check full content for file paths
  const fullMatches = fullContent.matchAll(FILE_PATH_RE);
  for (const m of fullMatches) {
    fileSet.add(m[0]);
  }
  const relevantFiles = Array.from(fileSet).slice(0, 15);

  // Score and select high-value messages
  const sorted = [...messages].sort((a, b) => b.score - a.score);
  const keepCount = Math.max(
    Math.min(15, messages.length),
    Math.ceil(messages.length * 0.4),
  );
  const keepSet = new Set(sorted.slice(0, keepCount).map((_, i) => sorted[i]!));
  const highValueMessages = messages
    .filter((_, idx) => keepSet.has(messages[idx]!))
    .sort((a, b) => messages.indexOf(a) - messages.indexOf(b)); // Original order

  return {
    goal,
    completedSteps: completedSteps.slice(0, 10),
    pendingSteps: pendingSteps.slice(0, 10),
    keyDecisions: keyDecisions.slice(0, 10),
    recentErrors,
    relevantFiles,
    highValueMessages,
    foldedCount: messages.length - highValueMessages.length,
    totalMessages: messages.length,
  };
}

// ---------------------------------------------------------------------------
// Output Building
// ---------------------------------------------------------------------------

function buildCompressedOutput(extracted: ExtractedConversation): string[] {
  const parts: string[] = [];

  parts.push("## Conversation Summary");
  parts.push("");

  // Goal
  parts.push("### Current Goal");
  parts.push(`> ${extracted.goal}`);
  parts.push("");

  // Steps
  if (extracted.completedSteps.length > 0) {
    parts.push("### Completed Steps");
    for (const step of extracted.completedSteps.slice(0, 10)) {
      parts.push(`- [x] ${step}`);
    }
    parts.push("");
  }

  if (extracted.pendingSteps.length > 0) {
    parts.push("### Pending Steps");
    for (const step of extracted.pendingSteps.slice(0, 10)) {
      parts.push(`- [ ] ${step}`);
    }
    parts.push("");
  }

  // Key decisions
  if (extracted.keyDecisions.length > 0) {
    parts.push("### Key Decisions");
    for (const decision of extracted.keyDecisions.slice(0, 8)) {
      parts.push(`- ${decision}`);
    }
    parts.push("");
  }

  // Recent errors
  if (extracted.recentErrors.length > 0) {
    parts.push("### Recent Errors");
    parts.push("```");
    for (const err of extracted.recentErrors) {
      parts.push(err);
    }
    parts.push("```");
    parts.push("");
  }

  // Relevant files
  if (extracted.relevantFiles.length > 0) {
    parts.push("### Relevant Files");
    for (const file of extracted.relevantFiles.slice(0, 10)) {
      parts.push(`- \`${file}\``);
    }
    parts.push("");
  }

  // High-value messages (compressed)
  if (extracted.highValueMessages.length > 0) {
    parts.push("### Key Messages");
    parts.push("");
    for (const msg of extracted.highValueMessages.slice(0, 15)) {
      const roleLabel = msg.role === "assistant" ? "🤖" : msg.role === "user" ? "👤" : "📋";
      const excerpt = msg.content.length > 300
        ? msg.content.slice(0, 300).replace(/\n/g, " ") + "..."
        : msg.content;
      parts.push(`**${roleLabel} ${msg.role}** (score: ${msg.score}): ${excerpt}`);
      parts.push("");
    }
  }

  // Folded count
  if (extracted.foldedCount > 0) {
    parts.push(`- **Messages Folded:** ${extracted.foldedCount}/${extracted.totalMessages}`);
  }

  return parts;
}

// ---------------------------------------------------------------------------
// Trimming
// ---------------------------------------------------------------------------

function trimConversationOutput(
  extracted: ExtractedConversation,
  maxTokens: number,
): string {
  const variants: ExtractedConversation[] = [
    extracted,
    { ...extracted, highValueMessages: extracted.highValueMessages.slice(0, 8), keyDecisions: extracted.keyDecisions.slice(0, 5) },
    { ...extracted, highValueMessages: extracted.highValueMessages.slice(0, 3), keyDecisions: [], recentErrors: extracted.recentErrors.slice(0, 1) },
  ];

  for (const variant of variants) {
    const md = buildCompressedOutput(variant).join("\n");
    if (countTokens(md) <= maxTokens) return md;
  }

  return tokenAwareTruncate(
    buildCompressedOutput(variants[variants.length - 1]!).join("\n"),
    maxTokens,
  );
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

function truncateFallback(
  content: string,
  maxTokens: number,
  warnings: string[],
): StrategyResult {
  let result = tokenAwareTruncate(content, maxTokens);
  warnings.push("Conversation history compression fell back to truncation");
  return {
    compressedContent: result,
    warnings,
    summary: "Truncated conversation (fallback)",
  };
}

