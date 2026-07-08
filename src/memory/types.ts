/**
 * Memory Service — Type Definitions
 *
 * All memory-related types matching the MemoryRecord, RepoProfile,
 * and ProfileFact data models from PRD §15.
 */

export type MemoryType =
  | "decision"
  | "bug"
  | "command"
  | "file_summary"
  | "project_rule"
  | "user_preference"
  | "current_task"
  | "test_failure"
  | "api_contract"
  | "dependency";

export type MemoryStatus = "active" | "superseded" | "forgotten" | "expired";

export type ForgetMode = "soft_forget" | "supersede" | "expire" | "hard_delete";

export interface MemoryRecord {
  id: string;
  scopeId: string;
  type: MemoryType;
  content: string;
  summary?: string;
  sourceRef?: string;
  confidence: number;
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  /** Memories that this memory supersedes (reverse of supersededBy). Computed. */
  supersedes?: string[];
  supersededBy?: string;
  tags?: string[];
  /** Content fingerprint for exact dedup (scopeId|type|normalizedContent). */
  fingerprint?: string;
}

// ---------------------------------------------------------------------------
// Repository input / output types
// ---------------------------------------------------------------------------

/** Input for MemoryRepository.remember(). */
export interface SaveMemoryInput {
  scopeId: string;
  type: MemoryType;
  content: string;
  summary?: string;
  sourceRef?: string;
  confidence?: number;
  profileTarget?: "static" | "dynamic";
  expiresAt?: string;
  tags?: string[];
  /** Optional: ID of an existing active memory to supersede atomically. */
  supersedesMemoryId?: string;
}

/** Return type for MemoryRepository.remember(). */
export interface RememberResult {
  action: "created" | "deduplicated" | "replaced";
  memoryId: string;
  scopeId: string;
  type: MemoryType;
  status: MemoryStatus;
  receiptId: string;
  /** Set when action=replaced — the memory that was superseded. */
  supersededMemoryId?: string;
}

/** Fields that list_context can sort by. */
export type ListMemorySortField =
  | "createdAt"
  | "updatedAt"
  | "type"
  | "status"
  | "confidence";

/** Sort order. */
export type SortOrder = "asc" | "desc";

/** Options for MemoryRepository.list(). */
export interface ListMemoryOptions {
  scopeId: string;
  types?: MemoryType[];
  status?: MemoryStatus[];
  limit?: number;
  offset?: number;
  sortBy?: ListMemorySortField;
  sortOrder?: SortOrder;
}

/** Paginated list result. */
export interface ListMemoryResult {
  scopeId: string;
  items: MemoryRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProfileFact {
  id: string;
  scopeId: string;
  layer: "static" | "dynamic";
  content: string;
  sourceMemoryId?: string;
  sourceRef?: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

/**
 * Full repo profile per PRD §15.5.
 *
 * Combines static long-term facts with dynamic transient context.
 * `updatedAt` is the most recent update across all facts.
 */
export interface RepoProfile {
  scopeId: string;
  staticFacts: ProfileFact[];
  dynamicContext: ProfileFact[];
  updatedAt: string;
}

export interface RecallResult {
  scopeId: string;
  profile: {
    static: ProfileFact[];
    dynamic: ProfileFact[];
  };
  memories: (MemoryRecord & { score: number; canExpand: boolean })[];
  relatedCompressedContexts: {
    ccrId: string;
    summary?: string;
    originalRef?: string;
    canRetrieveOriginal: boolean;
    /** Only present when retrieveOriginal=true and the original is retrievable. */
    retrievedOriginal?: {
      content: string;
      tokens: number;
      contentHash: string;
      contentType: string;
      createdAt: string;
    };
  }[];
  receiptId: string;
}
