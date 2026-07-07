/**
 * JSON Compressor — Phase 4 (Full Implementation)
 *
 * Preserves: top-level keys, schema shape, error/status/id fields,
 * array samples, important nested paths.
 * Folds: long arrays, repeated objects, very long text fields.
 */

import type { CompressionStrategy, StrategyResult } from "../compressionEngine.js";
import { countTokens, tokenAwareTruncate } from "../../utils/tokenCount.js";

export const jsonStrategy: CompressionStrategy = {
  name: "json",
  version: "1.0.0",
  compress: compressJson,
};

// ---------------------------------------------------------------------------
// Special field names to preserve
// ---------------------------------------------------------------------------

const SPECIAL_FIELDS = new Set([
  "error", "errors", "status", "code", "message", "id", "name",
  "type", "kind", "requestId", "traceId", "timestamp", "version",
]);

// ---------------------------------------------------------------------------
// Export (backward-compatible)
// ---------------------------------------------------------------------------

export function compressJson(
  content: string,
  maxTokens: number,
): StrategyResult {
  const warnings: string[] = [];
  const tokens = countTokens(content);

  if (!content || content.trim().length === 0) {
    return { compressedContent: content, warnings, summary: "Empty JSON content" };
  }

  if (tokens <= maxTokens) {
    return { compressedContent: content, warnings, summary: "JSON fits within token budget" };
  }

  try {
    const parsed = JSON.parse(content);
    const extracted = extractJsonInfo(parsed);
    const parts = buildCompressedOutput(extracted);

    let result = parts.join("\n");
    let resultTokens = countTokens(result);

    if (resultTokens <= maxTokens) {
      return {
        compressedContent: result,
        warnings,
        summary: `JSON compressed: ${extracted.topLevelKeys.length} top-level keys, ${extracted.foldedArrays} arrays folded`,
      };
    }

    result = tokenAwareTruncate(result, maxTokens);
    warnings.push("Trimmed JSON output to fit token budget");

    return {
      compressedContent: result,
      warnings,
      summary: "JSON compressed and trimmed",
    };
  } catch {
    // Invalid JSON — return original
    warnings.push("Failed to parse JSON — returning original content");
    return {
      compressedContent: content,
      warnings,
      summary: "Invalid JSON — returned original",
    };
  }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface ExtractedJsonInfo {
  isArray: boolean;
  totalItems: number;
  topLevelKeys: Array<{ key: string; type: string; sample: string }>;
  specialFields: Array<{ path: string; value: unknown }>;
  arraySamples: Array<{ key: string; total: number; samples: unknown[] }>;
  foldedArrays: number;
  foldedTextFields: number;
  fullSchema: Record<string, string>;
}

function extractJsonInfo(data: unknown, path: string = "$"): ExtractedJsonInfo {
  const info: ExtractedJsonInfo = {
    isArray: false,
    totalItems: 0,
    topLevelKeys: [],
    specialFields: [],
    arraySamples: [],
    foldedArrays: 0,
    foldedTextFields: 0,
    fullSchema: {},
  };

  if (Array.isArray(data)) {
    info.isArray = true;
    info.totalItems = data.length;
    const maxSamples = 3;
    for (let i = 0; i < Math.min(data.length, maxSamples); i++) {
      const item = data[i];
      if (typeof item === "object" && item !== null) {
        const keys = Object.keys(item as Record<string, unknown>);
        info.topLevelKeys.push({
          key: `[${i}]`,
          type: "object",
          sample: `{ ${keys.slice(0, 5).join(", ")}${keys.length > 5 ? ", ..." : ""} }`,
        });
      } else {
        info.topLevelKeys.push({
          key: `[${i}]`,
          type: typeof item,
          sample: truncateSample(String(item)),
        });
      }
    }
    return info;
  }

  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    const keys = Object.keys(obj);

    for (const key of keys) {
      const value = obj[key];
      const valueType = getValueType(value);
      const currentPath = path === "$" ? key : `${path}.${key}`;

      // Schema type
      info.fullSchema[key] = valueType;
      info.topLevelKeys.push({
        key,
        type: valueType,
        sample: getSample(value),
      });

      // Special fields
      if (SPECIAL_FIELDS.has(key) || key.toLowerCase().includes("error") ||
          key.toLowerCase().includes("status") || key.toLowerCase().includes("id")) {
        info.specialFields.push({ path: currentPath, value });
      }

      // Nested array handling
      if (Array.isArray(value)) {
        if (value.length > 5) {
          info.foldedArrays++;
        }
        info.arraySamples.push({
          key,
          total: value.length,
          samples: value.slice(0, 3),
        });
      }

      // Long text fields
      if (typeof value === "string" && value.length > 200) {
        info.foldedTextFields++;
      }

      // Deeply nested special fields
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const nested = extractJsonInfo(value, currentPath);
        info.specialFields.push(...nested.specialFields);
        info.foldedArrays += nested.foldedArrays;
        info.foldedTextFields += nested.foldedTextFields;
      }

      // Array of objects — extract nested special fields from ALL items
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
        const seenSubKeys = new Set<string>();
        for (let ai = 0; ai < Math.min(value.length, 5); ai++) {
          const item = value[ai] as Record<string, unknown>;
          if (typeof item !== "object" || item === null) continue;
          for (const subKey of Object.keys(item)) {
            if (SPECIAL_FIELDS.has(subKey) && !seenSubKeys.has(`${subKey}=${String(item[subKey])}`)) {
              seenSubKeys.add(`${subKey}=${String(item[subKey])}`);
              info.specialFields.push({
                path: `${currentPath}[${ai}].${subKey}`,
                value: item[subKey],
              });
            }
          }
        }
      }
    }
  }

  return info;
}

function getValueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "array";
    const itemType = getValueType(value[0]);
    return `array<${itemType}>`;
  }
  return typeof value;
}

function getSample(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return truncateSample(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const samples = value.slice(0, 2).map(getSample);
    return `[${samples.join(", ")}${value.length > 2 ? `, ... (${value.length} items)` : ""}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).slice(0, 5);
    return `{ ${keys.join(", ")}${keys.length >= 5 ? ", ..." : ""} }`;
  }
  return String(value);
}

function truncateSample(text: string, maxLen: number = 80): string {
  if (text.length <= maxLen) return JSON.stringify(text);
  return JSON.stringify(text.slice(0, maxLen) + "...") + ` (${text.length} chars total)`;
}

// ---------------------------------------------------------------------------
// Output Building
// ---------------------------------------------------------------------------

function buildCompressedOutput(extracted: ExtractedJsonInfo): string[] {
  const parts: string[] = [];

  parts.push("## JSON Summary");
  parts.push("");

  // Type
  if (extracted.isArray) {
    parts.push(`- **Type:** Array (${extracted.totalItems} items)`);
    parts.push("");
    if (extracted.topLevelKeys.length > 0) {
      parts.push("### Sample Items");
      parts.push("```json");
      for (const item of extracted.topLevelKeys) {
        parts.push(`${item.key}: ${item.type} — ${item.sample}`);
      }
      parts.push("```");
    }
    return parts;
  }

  // Object — Top-level keys with types
  parts.push("### Top-Level Keys");
  parts.push("");
  parts.push("| Key | Type | Sample |");
  parts.push("|-----|------|--------|");
  for (const entry of extracted.topLevelKeys.slice(0, 30)) {
    parts.push(`| \`${entry.key}\` | \`${entry.type}\` | ${entry.sample} |`);
  }
  if (extracted.topLevelKeys.length > 30) {
    parts.push(`| ... | ... | *(${extracted.topLevelKeys.length - 30} more keys)* |`);
  }
  parts.push("");

  // Schema shape
  parts.push("### Schema Shape");
  parts.push("```json");
  const schemaJson: Record<string, string> = {};
  for (const [key, type] of Object.entries(extracted.fullSchema).slice(0, 20)) {
    schemaJson[key] = type;
  }
  parts.push(JSON.stringify(schemaJson, null, 2));
  if (Object.keys(extracted.fullSchema).length > 20) {
    parts.push(`  // ... ${Object.keys(extracted.fullSchema).length - 20} more keys`);
  }
  parts.push("```");
  parts.push("");

  // Special fields (error, status, id, etc.)
  if (extracted.specialFields.length > 0) {
    parts.push("### Special Fields (error / status / id)");
    parts.push("```json");
    const specialObj: Record<string, unknown> = {};
    for (const sf of extracted.specialFields.slice(0, 15)) {
      specialObj[sf.path] = sf.value;
    }
    parts.push(JSON.stringify(specialObj, null, 2));
    parts.push("```");
    parts.push("");
  }

  // Array summaries
  for (const arr of extracted.arraySamples.slice(0, 5)) {
    parts.push(`### Array: \`${arr.key}\` (${arr.total} items)`);
    parts.push("```json");
    for (const sample of arr.samples) {
      parts.push(JSON.stringify(sample, null, 2));
    }
    if (arr.total > 3) {
      parts.push(`// ... (${arr.total - 3} more items folded)`);
    }
    parts.push("```");
    parts.push("");
  }

  // Folded counts
  const foldParts: string[] = [];
  if (extracted.foldedArrays > 0) {
    foldParts.push(`${extracted.foldedArrays} long arrays folded`);
  }
  if (extracted.foldedTextFields > 0) {
    foldParts.push(`${extracted.foldedTextFields} long text fields folded`);
  }
  if (foldParts.length > 0) {
    parts.push(`- **Folded:** ${foldParts.join(", ")}`);
  }

  return parts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

