/**
 * CodeContext Service Adapter
 *
 * Provides a unified interface for flows to interact with CodeContext services:
 * compression, memory, profile, receipts, originals, scope, and stats.
 *
 * Abstracts away the individual service imports so flows receive a single
 * adapter rather than importing each service separately.
 *
 * PRD §34: Harness 适配现有 CodeContext 服务。
 */

import type { Database } from "sql.js";

// ── Adapter Interface ─────────────────────────────────────────────────────────

export interface CodeContextAdapter {
  /** The SQLite database handle. */
  db: Database;

  // Compression
  compress: (content: string, contentType?: string) => Promise<{ ccrId: string; compressed: string; tokenSavings: number }>;
  retrieveOriginal: (ccrId: string) => Promise<{ content: string; contentType: string } | null>;
  deleteOriginal: (ccrId: string) => Promise<boolean>;
  listCompressions: () => Promise<Array<{ ccrId: string; contentType: string; createdAt: string }>>;

  // Memory
  remember: (content: string, type: string, tags?: string[]) => Promise<string>;
  recall: (query: string, limit?: number) => Promise<Array<{ id: string; content: string; score: number }>>;
  forget: (id: string, mode?: string) => Promise<boolean>;
  listContext: (status?: string) => Promise<Array<{ id: string; type: string; status: string }>>;

  // Profile
  getProfile: () => Promise<{ static: Record<string, string>; dynamic: Record<string, string> }>;
  setProfileFact: (key: string, value: string, layer: "static" | "dynamic") => Promise<void>;

  // Scope
  resolveScope: () => Promise<string>;

  // Stats
  getTokenStats: () => Promise<{ totalCompressions: number; totalTokensSaved: number }>;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a CodeContext adapter backed by real service implementations.
 * Stub: returns a placeholder that throws on every method.
 * Real implementation will wire up CompressionEngine, MemoryService, etc.
 */
export function createCodeContextAdapter(_db: Database): CodeContextAdapter {
  const notImplemented = (method: string) => (): never => {
    throw new Error(`CodeContextAdapter.${method} is not yet implemented.`);
  };

  return {
    db: _db,
    compress: notImplemented("compress"),
    retrieveOriginal: notImplemented("retrieveOriginal"),
    deleteOriginal: notImplemented("deleteOriginal"),
    listCompressions: notImplemented("listCompressions"),
    remember: notImplemented("remember"),
    recall: notImplemented("recall"),
    forget: notImplemented("forget"),
    listContext: notImplemented("listContext"),
    getProfile: notImplemented("getProfile"),
    setProfileFact: notImplemented("setProfileFact"),
    resolveScope: notImplemented("resolveScope"),
    getTokenStats: notImplemented("getTokenStats"),
  };
}
