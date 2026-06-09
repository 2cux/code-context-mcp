import type { Database } from "sql.js";
import { queryOne } from "../storage/db.js";

export interface TokenStats {
  totalCompressions: number;
  totalRetrieves: number;
  totalMemories: number;
  totalRecalls: number;
  totalForgets: number;
  totalFailures: number;
  totalTokensSaved: number;
  totalTokensBefore: number;
  totalTokensAfter: number;
  averageCompressionRatio: number;
}

export function getTokenStats(db: Database, scopeId: string): TokenStats {
  const row = queryOne(
    db,
    `SELECT
       COUNT(CASE WHEN operation = 'compress' THEN 1 END) AS c1,
       COUNT(CASE WHEN operation = 'retrieve_original' THEN 1 END) AS c2,
       COUNT(CASE WHEN operation = 'remember' THEN 1 END) AS c3,
       COUNT(CASE WHEN operation = 'recall' THEN 1 END) AS c4,
       COUNT(CASE WHEN operation = 'forget' THEN 1 END) AS c5,
       COUNT(CASE WHEN failed = 1 THEN 1 END) AS c6,
       COALESCE(SUM(tokens_saved), 0) AS s1,
       COALESCE(SUM(tokens_before), 0) AS s2,
       COALESCE(SUM(tokens_after), 0) AS s3,
       COALESCE(AVG(compression_ratio), 0) AS avg1
     FROM receipts
     WHERE scope_id = ?`,
    [scopeId],
  );

  return {
    totalCompressions: (row?.["c1"] as number) ?? 0,
    totalRetrieves: (row?.["c2"] as number) ?? 0,
    totalMemories: (row?.["c3"] as number) ?? 0,
    totalRecalls: (row?.["c4"] as number) ?? 0,
    totalForgets: (row?.["c5"] as number) ?? 0,
    totalFailures: (row?.["c6"] as number) ?? 0,
    totalTokensSaved: (row?.["s1"] as number) ?? 0,
    totalTokensBefore: (row?.["s2"] as number) ?? 0,
    totalTokensAfter: (row?.["s3"] as number) ?? 0,
    averageCompressionRatio: (row?.["avg1"] as number) ?? 0,
  };
}
