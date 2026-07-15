/**
 * Strategy registration module.
 *
 * Registers all available compression strategies with the engine's
 * strategy registry. Call `registerAllStrategies()` during
 * initialization before using the compression engine.
 */

import { registerStrategy } from "./compressionEngine.js";
import { testOutputStrategy } from "./strategies/testOutput.js";
import { logStrategy } from "./strategies/log.js";
import { commandOutputStrategy } from "./strategies/commandOutput.js";
import { codeStrategy } from "./strategies/code.js";
import { jsonStrategy } from "./strategies/json.js";
import { markdownStrategy } from "./strategies/markdown.js";
import { plainTextStrategy } from "./strategies/plainText.js";
import { ragChunkStrategy } from "./strategies/ragChunk.js";
import { conversationHistoryStrategy } from "./strategies/conversationHistory.js";

/**
 * Register all available compression strategies.
 *
 * Must be called before using `compress()`.
 * Idempotent: the registry is keyed by content type, so repeated calls leave
 * exactly the same strategy bindings and never create duplicate entries.
 */
export function registerAllStrategies(): void {
  registerStrategy("test_output", testOutputStrategy);
  registerStrategy("log", logStrategy);
  registerStrategy("command_output", commandOutputStrategy);
  registerStrategy("code", codeStrategy);
  registerStrategy("json", jsonStrategy);
  registerStrategy("markdown", markdownStrategy);
  registerStrategy("plain_text", plainTextStrategy);
  registerStrategy("rag_chunk", ragChunkStrategy);
  registerStrategy("conversation_history", conversationHistoryStrategy);
  // "file_summary" and "unknown" fall back to plain_text at runtime
}

export { plainTextStrategy } from "./strategies/plainText.js";
export { testOutputStrategy } from "./strategies/testOutput.js";
export { logStrategy } from "./strategies/log.js";
export { commandOutputStrategy } from "./strategies/commandOutput.js";
export { codeStrategy } from "./strategies/code.js";
export { jsonStrategy } from "./strategies/json.js";
export { markdownStrategy } from "./strategies/markdown.js";
export { ragChunkStrategy } from "./strategies/ragChunk.js";
export { conversationHistoryStrategy } from "./strategies/conversationHistory.js";
