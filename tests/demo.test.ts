/**
 * First-Run Value Demo Tests
 *
 * Tests the `code-context demo` command end-to-end:
 *   - runDemo returns ok status
 *   - report file is generated at reports/demo/first-run-value.md
 *   - report contains all required sections
 *   - individual steps (compress, remember, recall, retrieve) succeed
 */

import { describe, it, expect, afterAll } from "vitest";
import { existsSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { runDemo } from "../src/cli/commands.js";
import { closeDb } from "../src/storage/db.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPORTS_DEMO_DIR = join(process.cwd(), "reports", "demo");
const REPORT_PATH = join(REPORTS_DEMO_DIR, "first-run-value.md");

function cleanupReport(): void {
  try {
    if (existsSync(REPORT_PATH)) unlinkSync(REPORT_PATH);
    if (existsSync(REPORTS_DEMO_DIR)) rmdirSync(REPORTS_DEMO_DIR);
  } catch {
    // best-effort cleanup
  }
}

afterAll(() => {
  try {
    closeDb();
  } catch {
    // DB may already be closed
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("demo command", () => {
  it("runDemo returns ok status", async () => {
    const result = await runDemo();
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    expect(data.reportPath).toBe(REPORT_PATH);
  });

  it("generates the report file at reports/demo/first-run-value.md", async () => {
    const result = await runDemo();
    expect(result.status).toBe("ok");

    expect(existsSync(REPORT_PATH)).toBe(true);

    const content = readFileSync(REPORT_PATH, "utf-8");
    expect(content.length).toBeGreaterThan(500);
  });

  it("report contains all required sections", async () => {
    const result = await runDemo();
    expect(result.status).toBe("ok");

    const content = readFileSync(REPORT_PATH, "utf-8");

    // Required sections
    const requiredSections = [
      "# CodeContext — First-Run Value Demo",
      "## Step 1: Compress",
      "## Step 2: Save Project Memory",
      "## Step 3: Recall Project Memory",
      "## Step 4: Retrieve Original Content",
      "## Summary",
      "## What This Means for Your Workflow",
      "## Try It Yourself",
    ];

    for (const section of requiredSections) {
      expect(content).toContain(section);
    }
  });

  it("report contains key metrics", async () => {
    const result = await runDemo();
    expect(result.status).toBe("ok");

    const content = readFileSync(REPORT_PATH, "utf-8");

    // Key metrics should be present
    expect(content).toMatch(/tokens saved/i);
    expect(content).toMatch(/compression ratio/i);
    expect(content).toMatch(/original.*ref/i);
    expect(content).toMatch(/memory.*id/i);
  });

  it("report shows the compress step succeeded with positive token savings", async () => {
    const result = await runDemo();
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    const summary = data.summary as Record<string, string>;
    expect(summary.compress).toMatch(/tokens saved/);
    expect(summary.compress).not.toMatch(/failed/);
  });

  it("report shows the remember step succeeded", async () => {
    const result = await runDemo();
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    const summary = data.summary as Record<string, string>;
    expect(summary.remember).toMatch(/saved memory/);
    expect(summary.remember).not.toMatch(/failed/);
  });

  it("report shows the recall step succeeded", async () => {
    const result = await runDemo();
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    const summary = data.summary as Record<string, string>;
    expect(summary.recall).toMatch(/found/);
    expect(summary.recall).not.toMatch(/failed/);
  });

  it("report shows the retrieve step succeeded", async () => {
    const result = await runDemo();
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    const summary = data.summary as Record<string, string>;
    expect(summary.retrieve).toMatch(/recovered/);
    expect(summary.retrieve).not.toMatch(/failed/);
  });

  it("summary reports cover all four steps", async () => {
    const result = await runDemo();
    expect(result.status).toBe("ok");

    const data = result.data as Record<string, unknown>;
    const summary = data.summary as Record<string, string>;

    expect(summary.compress).toBeTruthy();
    expect(summary.remember).toBeTruthy();
    expect(summary.recall).toBeTruthy();
    expect(summary.retrieve).toBeTruthy();
  });

  it("demo report is readable markdown", async () => {
    const result = await runDemo();
    expect(result.status).toBe("ok");

    const content = readFileSync(REPORT_PATH, "utf-8");

    // Markdown structure checks
    expect(content).toMatch(/^# /m); // h1
    expect(content).toMatch(/^## /m); // h2
    expect(content).toMatch(/```/); // code blocks
    expect(content).toMatch(/\|.*\|.*\|/); // tables

    // Should not contain raw JSON (object or array at line start)
    expect(content).not.toMatch(/^\s*\{[^}]*\}/m);
    expect(content).not.toMatch(/^\s*\[\s*\{/m);
  });
});
