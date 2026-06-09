/**
 * compress_context MCP tool handler — PRD §11.2
 *
 * Full compress-context pipeline:
 *   1. Validate inputs (scopeId, content, contentType).
 *   2. Route through the Safety Layer (size limit → chunking → timeout → failOpen).
 *   3. Persist the CompressedContextRecord.
 *   4. Optionally save original content.
 *   5. Record a receipt.
 *   6. Return the CompressionOutput to the caller.
 *
 * All failure paths return the original content (failOpen principle).
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { compressSafely, type SafetyCompressResult } from "../../safety/safetyLayer.js";
import type { ServerContext } from "../server.js";
import { CompressedStore, type ContentType } from "../../compressed/compressedStore.js";
import { OriginalStore } from "../../originals/originalStore.js";
import { countTokens } from "../../utils/tokenCount.js";
import { contentHash } from "../../utils/hash.js";
import { detectContentType } from "../../router/contentRouter.js";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const VALID_CONTENT_TYPES = new Set<string>([
  "test_output",
  "log",
  "command_output",
  "code",
  "json",
  "markdown",
  "plain_text",
  "rag_chunk",
  "file_summary",
  "conversation_history",
  "unknown",
]);

const VALID_STRATEGIES = new Set(["auto", "conservative"]);

export async function handleCompressContext(
  ctx: ServerContext,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const { db, receipts } = ctx;
  const compressedStore = new CompressedStore(db);
  const originalStore = new OriginalStore(db);

  // ---- Validate inputs ----

  const scopeId = typeof args.scopeId === "string" ? args.scopeId : "";
  if (!scopeId) {
    return {
      content: [{ type: "text", text: "Error: scopeId is required." }],
      isError: true,
    };
  }

  const content = typeof args.content === "string" ? args.content : "";
  if (!content) {
    return {
      content: [{ type: "text", text: "Error: content is required." }],
      isError: true,
    };
  }

  const contentTypeRaw = typeof args.contentType === "string"
    ? args.contentType
    : "unknown";

  // Auto-detect content type when not explicitly provided or "unknown"
  let contentType: ContentType;
  let detectedBy: "user" | "auto" = "user";
  if (contentTypeRaw === "unknown" || !args.contentType) {
    const detection = detectContentType(content);
    contentType = detection.contentType;
    detectedBy = "auto";
  } else {
    if (!VALID_CONTENT_TYPES.has(contentTypeRaw)) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Invalid contentType "${contentTypeRaw}". Valid values: ${Array.from(VALID_CONTENT_TYPES).join(", ")}`,
          },
        ],
        isError: true,
      };
    }
    contentType = contentTypeRaw as ContentType;
  }

  const strategy = typeof args.strategy === "string" ? args.strategy : "conservative";
  if (!VALID_STRATEGIES.has(strategy)) {
    return {
      content: [
        {
          type: "text",
          text: `Error: Invalid strategy "${strategy}". Valid values: auto, conservative.`,
        },
      ],
      isError: true,
    };
  }

  const keepOriginal = args.keepOriginal !== false; // default true
  const maxTokens = typeof args.maxTokens === "number" ? args.maxTokens : 2000;
  const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : 5000;
  const maxInputBytes =
    typeof args.maxInputBytes === "number" ? args.maxInputBytes : 1_048_576;
  const userMetadata: Record<string, unknown> =
    typeof args.metadata === "object" && args.metadata !== null
      ? (args.metadata as Record<string, unknown>)
      : {};
  const metadata = {
    ...userMetadata,
    ...(detectedBy === "auto" ? { autoDetectedContentType: contentType } : {}),
  };

  // ---- Build compression input ----

  const input = {
    scopeId,
    content,
    contentType,
    strategy,
    keepOriginal,
    maxTokens,
    timeoutMs,
    metadata,
  };

  // ---- Compress via Safety Layer ----

  const safetyResult: SafetyCompressResult = await compressSafely(input, {
    sizeLimit: { maxInputBytes, failOpen: true },
    timeoutMs,
  });

  const output = safetyResult.output;

  // ---- Persist compressed record ----

  let savedRecord = null;
  try {
    savedRecord = compressedStore.save({
      scopeId: output.scopeId,
      contentType: output.contentType,
      strategy: output.strategy || "none",
      compressedContent: output.compressedContent,
      summary: output.summary,
      originalRef: output.originalRef,
      sourceRef: userMetadata.source as string | undefined,
      metadata: {
        ...(metadata ?? {}),
        safetyWarnings: safetyResult.safetyWarnings,
        safetyActions: safetyResult.safetyActions,
      },
      tokensBefore: output.tokensBefore,
      tokensAfter: output.tokensAfter,
      tokensSaved: output.tokensSaved,
      compressionRatio: output.compressionRatio,
      canRetrieveOriginal: output.canRetrieveOriginal,
      failed: output.failed ?? false,
      errorReason: output.errorReason,
    });
  } catch (dbErr) {
    // Database write failure — still return result, add warning
    const dbMessage = dbErr instanceof Error ? dbErr.message : String(dbErr);
    output.warnings.push(`Database write warning: unable to persist CCR — ${dbMessage}`);
  }

  // ---- Save original content ----

  if (keepOriginal && savedRecord) {
    try {
      originalStore.save({
        scopeId,
        ccrId: savedRecord.id,
        contentType,
        content,
        metadata: {
          ...(metadata ?? {}),
          safetyWarnings: safetyResult.safetyWarnings,
        },
      });
    } catch (origErr) {
      const origMessage = origErr instanceof Error ? origErr.message : String(origErr);
      output.warnings.push(`Warning: unable to save original content — ${origMessage}`);
    }
  }

  // ---- Record receipt ----

  try {
    const inputHash = contentHash(content);

    receipts.create({
      operation: "compress",
      scopeId,
      inputHash,
      resultIds: savedRecord ? [savedRecord.id] : [],
      ccrIds: savedRecord ? [savedRecord.id] : [],
      originalRefs: output.originalRef ? [output.originalRef] : [],
      tokensBefore: output.tokensBefore,
      tokensAfter: output.tokensAfter,
      tokensSaved: output.tokensSaved,
      compressionRatio: output.compressionRatio,
      compressed: output.compressed,
      failed: output.failed ?? false,
      errorReason: output.errorReason,
    });
  } catch (receiptErr) {
    const receiptMessage = receiptErr instanceof Error ? receiptErr.message : String(receiptErr);
    output.warnings.push(`Warning: unable to record receipt — ${receiptMessage}`);
  }

  // ---- Build response ----

  const result = {
    ccrId: savedRecord?.id ?? output.ccrId,
    compressed: output.compressed,
    scopeId: output.scopeId,
    contentType: output.contentType,
    strategy: output.strategy,
    compressedContent: output.compressedContent,
    summary: output.summary,
    originalRef: output.originalRef,
    tokensBefore: output.tokensBefore,
    tokensAfter: output.tokensAfter,
    tokensSaved: output.tokensSaved,
    compressionRatio: output.compressionRatio,
    canRetrieveOriginal: output.canRetrieveOriginal,
    receiptId: output.receiptId,
    warnings: output.warnings,
    ...(output.failed ? { failed: true, errorReason: output.errorReason } : {}),
    ...(safetyResult.safetyTriggered
      ? { safetyActions: safetyResult.safetyActions }
      : {}),
  };

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
