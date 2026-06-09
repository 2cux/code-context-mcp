/**
 * Compression Engine — Phase 2
 *
 * Routes content to the appropriate type-specific compressor
 * and produces a CompressedContextRecord.
 */

import type { ContentType } from "../router/contentRouter.js";

export interface CompressionInput {
  scopeId: string;
  content: string;
  contentType: ContentType;
  metadata?: Record<string, unknown>;
  strategy?: string;
  keepOriginal: boolean;
  maxTokens: number;
}

export interface CompressionOutput {
  ccrId: string;
  compressed: boolean;
  scopeId: string;
  contentType: ContentType;
  strategy: string;
  compressedContent: string;
  summary?: string;
  originalRef?: string;
  tokensBefore: number;
  tokensAfter: number;
  tokensSaved: number;
  compressionRatio: number;
  canRetrieveOriginal: boolean;
  receiptId: string;
  warnings: string[];
  // failure fields
  failed?: boolean;
  errorReason?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function compress(input: CompressionInput): Promise<CompressionOutput> {
  // TODO: Phase 2 — implement compression routing
  throw new Error("Compression engine not yet implemented (Phase 2)");
}
