/**
 * Automated Usability Evaluation Runner
 *
 * Analyzes 12 usability scenarios against 3 tool modes (full/agent/agent+flow).
 * Does NOT call real tools — performs static analysis of which tools an Agent
 * would select based on available tool sets.
 *
 * Usage: npx tsx scripts/usability-eval.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ── Types ──────────────────────────────────────────────────────────────────────

interface Scenario {
  id: string;
  goal: string;
  input: { cwd: string; content: string; query?: string; options?: Record<string, unknown> };
  expectedTools: string[];
  preferredTool: string;
  antiPatterns: string[];
  notes: string;
  scoreWeights: { toolSelection: number; taskCompletion: number; safety: number; efficiency: number };
}

interface ModeConfig {
  name: string;
  key: string;
  tools: string[];
}

interface PerScenarioResult {
  scenarioId: string;
  goal: string;
  mode: string;
  availableExpectedTools: string[];
  missingExpectedTools: string[];
  antiPatternToolsAvailable: string[];
  dangerousToolsAvailable: string[];
  toolSelectionScore: number;
  taskCompletionScore: number;
  safetyScore: number;
  efficiencyScore: number;
  totalScore: number;
  maxScore: number;
  notes: string;
}

interface ModeSummary {
  mode: string;
  totalScenarios: number;
  totalScore: number;
  maxPossible: number;
  percentage: number;
  avgToolSelectionScore: number;
  avgTaskCompletion: number;
  avgSafety: number;
  avgEfficiency: number;
}

// ── Tool Mode Configurations ───────────────────────────────────────────────────

const ALL_TOOLS: string[] = [
  "current_scope", "compress_context", "retrieve_original",
  "delete_original", "cleanup_originals", "list_compressions",
  "remember_context", "recall_context", "forget_context",
  "list_context", "analyze_context", "list_failures",
  "failure_stats", "list_harness_flows", "run_harness_flow",
  "get_harness_run", "check_harness_flow", "run_context_flow",
];

const DANGEROUS_TOOLS = new Set(["delete_original", "cleanup_originals"]);

const MODES: ModeConfig[] = [
  {
    name: "Full Tools",
    key: "full-tools",
    tools: [...ALL_TOOLS],
  },
  {
    name: "Agent Mode",
    key: "agent-mode",
    tools: [
      "current_scope", "compress_context", "retrieve_original",
      "list_compressions", "remember_context", "recall_context",
      "forget_context", "list_context", "analyze_context",
    ],
  },
  {
    name: "Agent Mode + run_context_flow",
    key: "agent-mode-plus-run-context-flow",
    tools: [
      "current_scope", "compress_context", "retrieve_original",
      "remember_context", "recall_context", "forget_context",
      "run_context_flow",
    ],
  },
];

// ── Load Scenarios ─────────────────────────────────────────────────────────────

const SCENARIOS_DIR = path.join(PROJECT_ROOT, "fixtures", "mcp-eval", "usability-scenarios");
// Fallback to the v3 download if not in fixtures
const ALT_SCENARIOS_DIR =
  "D:\\下载\\codecontext-mcp-usability-tool-surface-v3 (1)\\codecontext-mcp-usability-tool-surface-v3\\test-data\\usability-scenarios";

function loadScenarios(): Scenario[] {
  const dir = fs.existsSync(SCENARIOS_DIR) ? SCENARIOS_DIR : ALT_SCENARIOS_DIR;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as Scenario);
}

// ── Analysis Logic ─────────────────────────────────────────────────────────────

function analyzeMode(scenario: Scenario, mode: ModeConfig): PerScenarioResult {
  const availableTools = new Set(mode.tools);
  const expected = scenario.expectedTools;
  const anti = scenario.antiPatterns;

  const availableExpected = expected.filter((t) => availableTools.has(t));
  const missingExpected = expected.filter((t) => !availableTools.has(t));

  // Map anti-pattern strings to tool names
  const antiToolMap: Record<string, string> = {
    "unnecessary delete_original": "delete_original",
    "use list_context instead of recall_context": "list_context",
    "call run_harness_flow for normal agent task": "run_harness_flow",
    "use analyze_context as first choice without query intent": "analyze_context",
    "missing recall in memory scenario": "recall_context",
    "delete_original": "delete_original",
    "cleanup_originals": "cleanup_originals",
  };
  const antiToolsAvailable: string[] = [];
  for (const a of anti) {
    const tool = antiToolMap[a] ?? "";
    if (tool && availableTools.has(tool)) antiToolsAvailable.push(a);
  }

  const dangerousAvailable = [...DANGEROUS_TOOLS].filter((t) => availableTools.has(t));

  // Scoring
  const w = scenario.scoreWeights;

  // Tool selection: ratio of available expected tools
  const toolSelectionScore =
    expected.length > 0
      ? Math.round((availableExpected.length / expected.length) * w.toolSelection)
      : w.toolSelection;

  // Task completion: if ALL expected tools are available, full score; otherwise partial
  const taskCompletionScore =
    missingExpected.length === 0
      ? w.taskCompletion
      : Math.round((availableExpected.length / expected.length) * w.taskCompletion);

  // Safety: start at max, deduct for each dangerous/anti-pattern tool available
  let safetyScore = w.safety;
  safetyScore -= antiToolsAvailable.length * 5;
  safetyScore -= dangerousAvailable.length * 10;
  safetyScore = Math.max(0, safetyScore);

  // Efficiency: fewer tools = higher efficiency score (less choice overload)
  const efficiencyScore =
    mode.tools.length <= 7 ? w.efficiency :
    mode.tools.length <= 10 ? Math.round(w.efficiency * 0.8) :
    Math.round(w.efficiency * 0.5);

  const totalScore = toolSelectionScore + taskCompletionScore + safetyScore + efficiencyScore;
  const maxScore = w.toolSelection + w.taskCompletion + w.safety + w.efficiency;

  let notes = "";
  if (missingExpected.length > 0) notes += `Missing: ${missingExpected.join(", ")}. `;
  if (antiToolsAvailable.length > 0) notes += `Anti-patterns exposed: ${antiToolsAvailable.join("; ")}. `;
  if (dangerousAvailable.length > 0) notes += `Dangerous tools exposed: ${dangerousAvailable.join(", ")}. `;
  if (!notes) notes = "All expected tools available. No anti-patterns or dangerous tools in surface.";

  return {
    scenarioId: scenario.id,
    goal: scenario.goal,
    mode: mode.name,
    availableExpectedTools: availableExpected,
    missingExpectedTools: missingExpected,
    antiPatternToolsAvailable: antiToolsAvailable,
    dangerousToolsAvailable: dangerousAvailable,
    toolSelectionScore,
    taskCompletionScore,
    safetyScore,
    efficiencyScore,
    totalScore,
    maxScore,
    notes,
  };
}

// ── Aggregation ────────────────────────────────────────────────────────────────

function summarizeMode(results: PerScenarioResult[]): ModeSummary {
  const n = results.length;
  return {
    mode: results[0]?.mode ?? "",
    totalScenarios: n,
    totalScore: results.reduce((s, r) => s + r.totalScore, 0),
    maxPossible: results.reduce((s, r) => s + r.maxScore, 0),
    percentage: Math.round((results.reduce((s, r) => s + r.totalScore, 0) / results.reduce((s, r) => s + r.maxScore, 0)) * 100),
    avgToolSelectionScore: Math.round(results.reduce((s, r) => s + r.toolSelectionScore, 0) / n),
    avgTaskCompletion: Math.round(results.reduce((s, r) => s + r.taskCompletionScore, 0) / n),
    avgSafety: Math.round(results.reduce((s, r) => s + r.safetyScore, 0) / n),
    avgEfficiency: Math.round(results.reduce((s, r) => s + r.efficiencyScore, 0) / n),
  };
}

// ── Report Generation ──────────────────────────────────────────────────────────

function generateJsonReport(
  scenarios: Scenario[],
  allResults: PerScenarioResult[],
  summaries: ModeSummary[],
): Record<string, unknown> {
  return {
    generated: new Date().toISOString(),
    toolModes: MODES.map((m) => ({ name: m.name, key: m.key, toolCount: m.tools.length, tools: m.tools })),
    scenarios: scenarios.map((s) => ({
      id: s.id,
      goal: s.goal,
      expectedTools: s.expectedTools,
      preferredTool: s.preferredTool,
      antiPatterns: s.antiPatterns,
    })),
    results: allResults,
    summary: {
      rankings: summaries.sort((a, b) => b.percentage - a.percentage).map((s) => ({
        mode: s.mode,
        percentage: s.percentage,
        totalScore: `${s.totalScore}/${s.maxPossible}`,
      })),
      details: summaries,
    },
    recommendation: generateRecommendation(summaries),
  };
}

function generateRecommendation(summaries: ModeSummary[]): Record<string, unknown> {
  const sorted = [...summaries].sort((a, b) => b.percentage - a.percentage);
  const best = sorted[0]!;
  return {
    recommendedDefaultMode: best.mode,
    rationale: `Highest overall score (${best.percentage}%) with best balance of tool availability, safety, and efficiency.`,
    scoring: sorted.map((s) => ({
      mode: s.mode,
      score: s.percentage,
      strengths: [
        s.avgSafety >= 20 ? "Excellent safety (no dangerous tools exposed)" : null,
        s.avgEfficiency >= 16 ? "Low tool overload" : null,
        s.avgTaskCompletion >= 30 ? "Full task completion capability" : null,
      ].filter(Boolean),
    })),
    nextSteps: [
      "Validate these results with real Agent testing (manual).",
      "If confirmed, implement tool surface pruning per TOOL_PRUNING_DECISIONS.md.",
      "Monitor agent-mode-plus-run-context-flow adoption rates.",
    ],
  };
}

function generateMarkdownReport(json: Record<string, unknown>): string {
  const results = json.results as PerScenarioResult[];
  const summary = json.summary as { rankings: Array<Record<string, unknown>>; details: ModeSummary[] };
  const rec = json.recommendation as Record<string, unknown>;
  const scenarios = json.scenarios as Array<Record<string, unknown>>;

  let md = "# Agent Usability Report\n\n";
  md += `**Generated**: ${json.generated as string}\n\n`;

  // Modes table
  md += `## Tool Modes Compared\n\n`;
  md += `| Mode | Key | Tool Count |\n|---|---:|\n`;
  const modes = json.toolModes as Array<Record<string, unknown>>;
  for (const m of modes) {
    md += `| ${m.name as string} | ${m.key as string} | ${m.toolCount as number} |\n`;
  }

  // Results matrix
  md += `\n## Results Matrix\n\n`;
  md += `| Scenario | Mode | Expected Tools | Available | Missing | Tool Score | Task Score | Safety | Efficiency | Total |\n`;
  md += `|---|---|---|---:|---:|---:|---:|---:|---:|---:|\n`;
  for (const r of results) {
    const missing = r.missingExpectedTools.length > 0 ? r.missingExpectedTools.join(", ") : "—";
    md += `| ${r.scenarioId} | ${r.mode} | ${r.availableExpectedTools.join(", ") || "—"} | ${r.availableExpectedTools.length} | ${missing} | ${r.toolSelectionScore} | ${r.taskCompletionScore} | ${r.safetyScore} | ${r.efficiencyScore} | ${r.totalScore}/${r.maxScore} |\n`;
  }

  // Summary
  md += `\n## Mode Comparison\n\n`;
  md += `| Mode | Score | % | Tool Selection | Task Completion | Safety | Efficiency |\n`;
  md += `|---|---:|---:|---:|---:|---:|---:|\n`;
  for (const s of summary.details) {
    md += `| ${s.mode} | ${s.totalScore}/${s.maxPossible} | ${s.percentage}% | ${s.avgToolSelectionScore} | ${s.avgTaskCompletion} | ${s.avgSafety} | ${s.avgEfficiency} |\n`;
  }

  // Rankings
  md += `\n## Rankings\n\n`;
  const rankings = summary.rankings as Array<Record<string, unknown>>;
  for (let i = 0; i < rankings.length; i++) {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
    md += `${medal} **${rankings[i]!.mode as string}** — ${rankings[i]!.percentage as number}% (${rankings[i]!.totalScore as string})\n\n`;
  }

  // Scenarios detail
  md += `\n## Scenario Details\n\n`;
  for (const s of scenarios) {
    md += `### ${s.id as string}\n\n`;
    md += `**Goal**: ${s.goal as string}\n\n`;
    md += `- Expected tools: ${(s.expectedTools as string[]).join(", ")}\n`;
    md += `- Preferred: ${s.preferredTool as string}\n`;
    md += `- Anti-patterns: ${(s.antiPatterns as string[]).join("; ")}\n\n`;
  }

  // Recommendation
  md += `\n## Recommendation\n\n`;
  md += `**Recommended default mode**: ${rec.recommendedDefaultMode as string}\n\n`;
  md += `${rec.rationale as string}\n\n`;
  const scoring = rec.scoring as Array<Record<string, unknown>>;
  for (const s of scoring) {
    md += `- **${s.mode as string}** (${s.score as number}%): ${(s.strengths as string[]).join(", ")}\n`;
  }
  md += `\n### Next Steps\n\n`;
  const next = rec.nextSteps as string[];
  for (const n of next) {
    md += `- ${n}\n`;
  }

  return md;
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main(): void {
  console.log("Loading scenarios...");
  const scenarios = loadScenarios();
  console.log(`Loaded ${scenarios.length} scenarios.`);

  const allResults: PerScenarioResult[] = [];
  const summaries: ModeSummary[] = [];

  for (const mode of MODES) {
    console.log(`\n=== ${mode.name} (${mode.tools.length} tools) ===`);
    const modeResults: PerScenarioResult[] = [];
    for (const scenario of scenarios) {
      const result = analyzeMode(scenario, mode);
      modeResults.push(result);
      console.log(`  ${scenario.id}: ${result.totalScore}/${result.maxScore} — ${result.notes}`);
    }
    const summary = summarizeMode(modeResults);
    summaries.push(summary);
    console.log(`  TOTAL: ${summary.totalScore}/${summary.maxPossible} (${summary.percentage}%)`);
    allResults.push(...modeResults);
  }

  // Generate reports
  const jsonReport = generateJsonReport(scenarios, allResults, summaries);
  const mdReport = generateMarkdownReport(jsonReport);

  const reportsDir = path.join(PROJECT_ROOT, "reports", "usability");
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  fs.writeFileSync(path.join(reportsDir, "agent-usability-report.json"), JSON.stringify(jsonReport, null, 2), "utf-8");
  fs.writeFileSync(path.join(reportsDir, "agent-usability-report.md"), mdReport, "utf-8");

  console.log(`\nReports written to ${reportsDir}/`);
}

main();
