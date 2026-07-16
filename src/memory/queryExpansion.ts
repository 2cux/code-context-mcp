/**
 * Conservative, local query expansion for common Chinese technical terms.
 *
 * This deliberately uses a small static dictionary instead of fuzzy matching
 * or an external service. ASCII tokens from the original query (including API
 * paths, headers, identifiers, filenames, and numbers) are copied verbatim.
 */

export interface ExpandedQuery {
  originalQuery: string;
  expandedQuery?: string;
  originalTerms: string[];
  expandedTerms: string[];
}

const TECH_TERM_EXPANSIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["本地优先", ["local-first"]],
  ["离线优先", ["offline-first"]],
  ["幂等键", ["idempotency", "key"]],
  ["幂等性", ["idempotency"]],
  ["幂等", ["idempotency"]],
  ["请求头", ["header"]],
  ["响应头", ["header"]],
  ["接口路径", ["API", "path"]],
  ["接口", ["API", "endpoint"]],
  ["超时时间", ["timeout"]],
  ["超时", ["timeout"]],
  ["包管理器", ["package", "manager"]],
  ["依赖安装", ["dependency", "install"]],
  ["安装依赖", ["install", "dependency"]],
  ["身份认证", ["authentication"]],
  ["权限校验", ["authorization"]],
  ["数据库", ["database"]],
  ["缓存", ["cache"]],
  ["重试", ["retry"]],
  ["限流", ["rate", "limit"]],
  ["日志", ["log"]],
  ["错误", ["error"]],
  ["测试", ["test"]],
  ["构建", ["build"]],
  ["配置", ["configuration"]],
  ["依赖", ["dependency"]],
];

/** ASCII-ish tokens that must survive expansion exactly as entered. */
const PRESERVED_TOKEN = /\/?[A-Za-z0-9_$@.][A-Za-z0-9_$@./:\\-]*/g;

export function expandTechnicalQuery(query: string): ExpandedQuery {
  const originalQuery = query.trim();
  if (!originalQuery) {
    return { originalQuery, originalTerms: [], expandedTerms: [] };
  }

  const preservedTerms = originalQuery.match(PRESERVED_TOKEN) ?? [];
  const translatedTerms: string[] = [];
  const matchedChineseTerms: string[] = [];

  // Entries are ordered longest-first where they overlap. Once a longer
  // phrase matches, suppress its shorter substring to avoid noisy expansion.
  const coveredRanges: Array<readonly [number, number]> = [];
  for (const [chinese, english] of TECH_TERM_EXPANSIONS) {
    let from = 0;
    let matched = false;
    while (from < originalQuery.length) {
      const index = originalQuery.indexOf(chinese, from);
      if (index < 0) break;
      const end = index + chinese.length;
      const overlaps = coveredRanges.some(([start, stop]) => index < stop && end > start);
      if (!overlaps) {
        coveredRanges.push([index, end]);
        matched = true;
      }
      from = end;
    }
    if (matched) {
      matchedChineseTerms.push(chinese);
      translatedTerms.push(...english);
    }
  }

  const expandedTerms = uniqueTerms([...preservedTerms, ...translatedTerms]);
  const hasTranslation = translatedTerms.length > 0;

  return {
    originalQuery,
    expandedQuery: hasTranslation ? expandedTerms.join(" ") : undefined,
    originalTerms: uniqueTerms([...matchedChineseTerms, ...preservedTerms]),
    expandedTerms,
  };
}

export function findMatchedTerms(
  content: string,
  summary: string | undefined,
  terms: readonly string[],
): string[] {
  const haystack = `${summary ?? ""}\n${content}`.toLocaleLowerCase();
  return uniqueTerms(
    terms.filter((term) => haystack.includes(term.toLocaleLowerCase())),
  );
}

function uniqueTerms(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const term of terms) {
    const normalized = term.toLocaleLowerCase();
    if (!term || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(term);
  }
  return result;
}
