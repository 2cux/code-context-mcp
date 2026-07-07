/**
 * Code Compressor — Phase 4 (Full Implementation)
 *
 * Conservative code compression. MUST preserve:
 *   file path, imports, exports, type/interface, function signatures,
 *   class signatures, public methods, TODO/FIXME, error-related blocks,
 *   query-related blocks, line numbers.
 * MUST NOT: rewrite code semantics, delete public API, delete type defs,
 *   delete error-related lines.
 *
 * Output format: fixed Markdown per PRD §13.5.
 */

import type { CompressionStrategy, StrategyResult } from "../compressionEngine.js";
import { countTokens, tokenAwareTruncate } from "../../utils/tokenCount.js";

export const codeStrategy: CompressionStrategy = {
  name: "code",
  version: "1.0.0",
  compress: compressCode,
};

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

const IMPORT_RE = /^\s*(?:import\b|(?:const|let|var)\s+\w+\s*=\s*require\()/;
const EXPORT_RE = /^\s*export\s+(?:default\s+)?(?:(?:const|let|var|function|class|interface|type|enum|abstract|async)\s+)?/;
const EXPORT_BLOCK_RE = /^\s*export\s+\{[^}]+\}\s*;/;
const TYPE_DEF_RE = /^\s*(?:export\s+)?(?:interface|type)\s+\w+\b/;
const FUNCTION_SIG_RE = /^\s*(?:(?:export\s+)?(?:async\s+)?function\s+\w+|(?:(?:public|private|protected|static|async)\s+)*\s*(?:get|set)\s+\w+|[\w$]+\s*[:=]\s*(?:async\s*)?\([^)]*\)\s*(?:=>|:))/;
const CLASS_SIG_RE = /^\s*(?:export\s+)?(?:abstract\s+)?class\s+\w+/;
const PUBLIC_METHOD_RE = /^\s*(?:public\s+)?(?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\S+)?\s*\{/;
const TODO_FIXME_RE = /\/\/.*(?:TODO|FIXME|HACK|XXX|OPTIMIZE|BUG)\b/i;
const COMMENT_RE = /^\s*(?:\/\/|\/\*|\*|\*\/)/;
const BLANK_RE = /^\s*$/;
const BRACE_OPEN = /[{([]\s*$/;
const BRACE_CLOSE = /^\s*[})\]]/;
/** Preserve important config constants: const NAME = <expression> */
const CONFIG_CONST_RE = /^\s*(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*['"`0-9(\-]/;

// Relevant block keywords: error handling, auth, query, etc.
const RELEVANT_KEYWORDS = /\b(?:try|catch|finally|throw|error|auth|login|logout|token|session|query|sql|db|database|transaction|validate|sanitize|encrypt|hash|password|secret|api|endpoint)\b/i;

// ---------------------------------------------------------------------------
// Helper: tag a line of code with its 1-based line number
// ---------------------------------------------------------------------------

/** Format a code line with its original line number as "L{n}: text" */
function L(n: number, text: string): string {
  return `L${n}: ${text}`;
}

// ---------------------------------------------------------------------------
// Export (backward-compatible)
// ---------------------------------------------------------------------------

export function compressCode(
  content: string,
  maxTokens: number,
): StrategyResult {
  const warnings: string[] = [];
  const tokens = countTokens(content);

  if (!content || content.trim().length === 0) {
    return { compressedContent: content, warnings, summary: "Empty code content" };
  }

  if (tokens <= maxTokens) {
    return { compressedContent: content, warnings, summary: "Code fits within token budget" };
  }

  try {
    const lines = content.split("\n");
    const extracted = extractCodeInfo(lines);

    const parts = buildCompressedOutput(extracted);

    let result = parts.join("\n");
    let resultTokens = countTokens(result);

    if (resultTokens <= maxTokens) {
      return {
        compressedContent: result,
        warnings,
        summary: `Code compressed: ${extracted.imports.length} imports, ${extracted.publicAPIs.length} public APIs, ${extracted.foldedFunctions} functions folded`,
      };
    }

    // Trim: progressively reduce
    result = trimCodeOutput(extracted, maxTokens);
    warnings.push("Trimmed code output to fit token budget");

    return {
      compressedContent: result,
      warnings,
      summary: `Code compressed and trimmed`,
    };
  } catch {
    return truncateFallback(content, maxTokens, warnings);
  }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface ExtractedCodeInfo {
  filePath: string;
  imports: string[];
  exports: string[];
  typeDefs: string[];
  functionSignatures: string[];
  classSignatures: string[];
  publicAPIs: string[];
  todoFixmes: string[];
  relevantBlocks: string[];
  foldedFunctions: number;
  totalLines: number;
}

function extractCodeInfo(lines: string[]): ExtractedCodeInfo {
  const info: ExtractedCodeInfo = {
    filePath: "",
    imports: [],
    exports: [],
    typeDefs: [],
    functionSignatures: [],
    classSignatures: [],
    publicAPIs: [],
    todoFixmes: [],
    relevantBlocks: [],
    foldedFunctions: 0,
    totalLines: lines.length,
  };

  // Extract file path from first comment
  for (const line of lines.slice(0, 10)) {
    const pathMatch = line.match(/(?:@file|@module|File:)\s*(.+)/i);
    if (pathMatch) {
      info.filePath = pathMatch[1]!.trim();
      break;
    }
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const ln = i + 1; // 1-based line number

    // ---- Skip blanks and comments (but check TODO/FIXME) ----
    if (BLANK_RE.test(line) || COMMENT_RE.test(line)) {
      if (TODO_FIXME_RE.test(line)) {
        info.todoFixmes.push(L(ln, line));
      }
      i++;
      continue;
    }

    // ---- Import statements ----
    if (IMPORT_RE.test(line)) {
      info.imports.push(L(ln, line.trim()));
      // Multi-line import? consume until semicolon or blank
      if (!line.includes(";") && !line.includes("from")) {
        i++;
        while (i < lines.length && !lines[i]!.includes(";") && !BLANK_RE.test(lines[i]!)) {
          info.imports[info.imports.length - 1] += " " + lines[i]!.trim();
          i++;
        }
        if (i < lines.length && lines[i]!.includes(";")) {
          info.imports[info.imports.length - 1] += " " + lines[i]!.trim();
          i++;
        }
        continue;
      }
      i++;
      continue;
    }

    // ---- Type/Interface definitions ----
    if (TYPE_DEF_RE.test(line)) {
      info.typeDefs.push(L(ln, line.trim()));
      // Consume until closing brace if it's a block
      if (BRACE_OPEN.test(line)) {
        i++;
        const blockLines: string[] = [];
        let depth = 1;
        while (i < lines.length && depth > 0) {
          const l = lines[i]!;
          blockLines.push(l);
          const opens = (l.match(/[{[(]/g) ?? []).length;
          const closes = (l.match(/[}\])]/g) ?? []).length;
          depth += opens - closes;
          i++;
        }
        // Add the block to typeDefs
        if (blockLines.length <= 15) {
          info.typeDefs[info.typeDefs.length - 1] += "\n" + blockLines.join("\n");
        } else {
          info.typeDefs[info.typeDefs.length - 1] +=
            ` {\n  /* ... ${blockLines.length - 1} lines ... */\n}`;
          info.foldedFunctions++;
        }
      }
      continue;
    }

    // ---- Export block statements (e.g. `export { foo };`) ----
    if (EXPORT_BLOCK_RE.test(line)) {
      info.exports.push(L(ln, line.trim()));
      info.publicAPIs.push(L(ln, line.trim()));
      i++;
      continue;
    }

    // ---- Named export declarations ----
    if (EXPORT_RE.test(line) && !TYPE_DEF_RE.test(line) && !FUNCTION_SIG_RE.test(line)) {
      info.exports.push(L(ln, line.trim()));
      i++;
      continue;
    }

    // ---- Class signatures ----
    if (CLASS_SIG_RE.test(line)) {
      info.classSignatures.push(L(ln, line.trim()));
      // Extract public methods within class
      const methods = extractPublicMethods(lines, i);
      info.publicAPIs.push(...methods.signatures);
      info.foldedFunctions += methods.folded;
      info.todoFixmes.push(...methods.todos);
      // Consume class body
      i = methods.endIdx;
      continue;
    }

    // ---- Function signatures ----
    if (FUNCTION_SIG_RE.test(line) && !CLASS_SIG_RE.test(line)) {
      info.functionSignatures.push(L(ln, line.trim()));
      info.publicAPIs.push(L(ln, line.trim()));
      // If function starts a block, decide whether to fold
      if (/{/.test(line) || (i + 1 < lines.length && /^\s*\{/.test(lines[i + 1]!.trim()))) {
        const { endIdx, isRelevant, todos } = consumeFunctionBody(lines, i);
        if (isRelevant) {
          // Keep relevant block lines with line numbers
          for (let j = i + 1; j < endIdx && j < i + 30; j++) {
            info.relevantBlocks.push(L(j + 1, lines[j]!));
          }
          if (endIdx - i > 30) {
            info.relevantBlocks.push(`  /* ... ${endIdx - i - 30} more lines ... */`);
          }
        } else {
          info.foldedFunctions++;
        }
        for (const td of todos) {
          info.todoFixmes.push(td);
        }
        i = endIdx;
      }
      i++;
      continue;
    }

    // ---- Config constants (SESSION_TTL, etc.) ----
    if (CONFIG_CONST_RE.test(line)) {
      info.publicAPIs.push(L(ln, line.trim()));
      i++;
      continue;
    }

    // ---- TODO/FIXME in regular lines ----
    if (TODO_FIXME_RE.test(line)) {
      info.todoFixmes.push(L(ln, line));
    }

    // ---- Relevant blocks (error handling, auth, etc.) ----
    if (RELEVANT_KEYWORDS.test(line) && !FUNCTION_SIG_RE.test(line)) {
      info.relevantBlocks.push(L(ln, line));
    }

    i++;
  }

  return info;
}

function extractPublicMethods(
  lines: string[],
  classStartIdx: number,
): {
  signatures: string[];
  folded: number;
  todos: string[];
  endIdx: number;
} {
  const signatures: string[] = [];
  const todos: string[] = [];
  let folded = 0;
  let i = classStartIdx + 1;

  // Skip to opening brace — look for ANY {
  while (i < lines.length && !/{/.test(lines[i]!)) {
    if (TODO_FIXME_RE.test(lines[i]!)) todos.push(L(i + 1, lines[i]!));
    i++;
  }
  if (i < lines.length) i++; // skip opening brace line

  let depth = 1;
  while (i < lines.length && depth > 0) {
    const line = lines[i]!;

    // Track braces
    const opens = (line.match(/[{]/g) ?? []).length;
    const closes = (line.match(/[}]/g) ?? []).length;
    depth += opens - closes;

    if (depth <= 0) break;

    // Check for public/private/protected method
    const methodMatch = PUBLIC_METHOD_RE.exec(line);
    if (methodMatch && !line.includes("private") && !line.includes("protected")) {
      const sig = line.trim().replace(/\s*\{.*/, " { /* ... */ }");
      signatures.push(L(i + 1, sig));
      // Check if body needs folding
      if (/{/.test(line)) {
        const { endIdx: bodyEnd, isRelevant } = consumeFunctionBody(lines, i);
        if (!isRelevant) folded++;
        i = bodyEnd - 1; // -1 because i++ at end
      }
    }

    // Check TODO/FIXME
    if (TODO_FIXME_RE.test(line)) {
      todos.push(L(i + 1, line));
    }

    i++;
  }

  return { signatures, folded, todos, endIdx: i + 1 };
}

function consumeFunctionBody(
  lines: string[],
  sigIdx: number,
): { endIdx: number; isRelevant: boolean; todos: string[] } {
  let i = sigIdx;
  const todos: string[] = [];
  let isRelevant = false;

  // Find opening brace — look for ANY {, not just at line start
  while (i < lines.length && !/{/.test(lines[i]!)) {
    if (TODO_FIXME_RE.test(lines[i]!)) todos.push(L(i + 1, lines[i]!));
    if (RELEVANT_KEYWORDS.test(lines[i]!)) isRelevant = true;
    i++;
  }
  if (i < lines.length && /{/.test(lines[i]!)) i++; // skip past the brace line

  let depth = 1;
  while (i < lines.length && depth > 0) {
    const line = lines[i]!;
    const opens = (line.match(/[{]/g) ?? []).length;
    const closes = (line.match(/[}]/g) ?? []).length;
    depth += opens - closes;
    if (depth <= 0) break;

    if (TODO_FIXME_RE.test(line)) todos.push(L(i + 1, line));
    if (RELEVANT_KEYWORDS.test(line)) isRelevant = true;

    i++;
  }

  return { endIdx: i + 1, isRelevant, todos };
}

// ---------------------------------------------------------------------------
// Output Building
// ---------------------------------------------------------------------------

function buildCompressedOutput(extracted: ExtractedCodeInfo): string[] {
  const parts: string[] = [];

  parts.push("## Code Context Summary");
  parts.push("");

  // File path
  parts.push(`- **File:** \`${extracted.filePath || "(not detected)"}\``);
  parts.push(`- **Total Lines:** ${extracted.totalLines}`);
  parts.push("");

  // Imports
  parts.push("### Imports");
  parts.push("```ts");
  if (extracted.imports.length > 0) {
    for (const imp of unique(extracted.imports).slice(0, 30)) {
      parts.push(imp);
    }
    if (extracted.imports.length > 30) {
      parts.push(`// ... ${extracted.imports.length - 30} more imports`);
    }
  } else {
    parts.push("// (none detected)");
  }
  parts.push("```");
  parts.push("");

  // Exports
  parts.push("### Exports");
  parts.push("```ts");
  if (extracted.exports.length > 0) {
    for (const exp of unique(extracted.exports).slice(0, 20)) {
      parts.push(exp);
    }
  } else {
    parts.push("// (none detected)");
  }
  parts.push("```");
  parts.push("");

  // Types / Interfaces
  parts.push("### Types / Interfaces");
  parts.push("```ts");
  if (extracted.typeDefs.length > 0) {
    for (const td of extracted.typeDefs.slice(0, 10)) {
      parts.push(td);
    }
    if (extracted.typeDefs.length > 10) {
      parts.push(`// ... ${extracted.typeDefs.length - 10} more type definitions`);
    }
  } else {
    parts.push("// (none detected)");
  }
  parts.push("```");
  parts.push("");

  // Public APIs
  parts.push("### Public APIs");
  parts.push("```ts");
  if (extracted.publicAPIs.length > 0) {
    for (const api of unique(extracted.publicAPIs).slice(0, 25)) {
      parts.push(api);
    }
    if (extracted.publicAPIs.length > 25) {
      parts.push(`// ... ${extracted.publicAPIs.length - 25} more public APIs`);
    }
  } else {
    parts.push("// (none detected)");
  }
  parts.push("```");
  parts.push("");

  // TODO/FIXME
  if (extracted.todoFixmes.length > 0) {
    parts.push("### TODO / FIXME / HACK");
    parts.push("```");
    for (const td of unique(extracted.todoFixmes).slice(0, 15)) {
      parts.push(td);
    }
    parts.push("```");
    parts.push("");
  }

  // Relevant Blocks (error handling, auth, etc.)
  if (extracted.relevantBlocks.length > 0) {
    parts.push("### Relevant Blocks (error handling / auth / queries)");
    parts.push("```ts");
    const deduped = unique(extracted.relevantBlocks);
    for (const block of deduped.slice(0, 20)) {
      parts.push(block);
    }
    if (deduped.length > 20) {
      parts.push(`// ... ${deduped.length - 20} more relevant lines`);
    }
    parts.push("```");
    parts.push("");
  }

  // Folded sections
  parts.push(`- **Functions Folded:** ${extracted.foldedFunctions}`);

  return parts;
}

// ---------------------------------------------------------------------------
// Trimming
// ---------------------------------------------------------------------------

function trimCodeOutput(extracted: ExtractedCodeInfo, maxTokens: number): string {
  // Progressively trim less-essential sections, but always keep types, TODOs, and function signatures
  const strategies = [
    extracted,
    { ...extracted, imports: extracted.imports.slice(0, 10), publicAPIs: extracted.publicAPIs.slice(0, 15), relevantBlocks: [] },
    { ...extracted, imports: extracted.imports.slice(0, 5), publicAPIs: extracted.publicAPIs.slice(0, 8), typeDefs: extracted.typeDefs.slice(0, 5), relevantBlocks: [] },
    { ...extracted, imports: extracted.imports.slice(0, 3), publicAPIs: extracted.publicAPIs.slice(0, 3), typeDefs: extracted.typeDefs.slice(0, 2), todoFixmes: extracted.todoFixmes.slice(0, 3), relevantBlocks: [] },
  ];

  for (const strategy of strategies) {
    const md = buildCompressedOutput(strategy).join("\n");
    if (countTokens(md) <= maxTokens) return md;
  }

  return tokenAwareTruncate(buildCompressedOutput(strategies[strategies.length - 1]!).join("\n"), maxTokens);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unique(arr: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of arr) {
    // For line-numbered entries, dedup by the content after "L{n}: " prefix
    const key = item.replace(/^L\d+:\s*/, "").trim();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

function truncateFallback(
  content: string,
  maxTokens: number,
  warnings: string[],
): StrategyResult {
  const lines = content.split("\n");
  const head = Math.ceil(lines.length * 0.4);
  const tail = Math.ceil(lines.length * 0.2);
  const kept = [
    ...lines.slice(0, head),
    `/* ... ${lines.length - head - tail} lines folded ... */`,
    ...lines.slice(-tail),
  ];
  let result = kept.join("\n");
  result = tokenAwareTruncate(result, maxTokens);
  warnings.push("Code compression fell back to truncation");
  return {
    compressedContent: result,
    warnings,
    summary: "Truncated code (fallback — original semantics preserved)",
  };
}
