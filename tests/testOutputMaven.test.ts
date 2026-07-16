import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compressTestOutput } from "../src/compression/strategies/testOutput.js";

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, "fixtures", name), "utf8");
}

function statusOf(content: string): string {
  return compressTestOutput(content, 160).summary;
}

describe("test_output Maven/Surefire status regression", () => {
  it("never reports PASSED when a multi-module summary contains BUILD FAILURE", () => {
    const output = fixture("maven-multimodule-build-failure.txt");
    const result = compressTestOutput(output, 240);

    expect(result.summary).toContain("status: FAILED");
    expect(result.summary).not.toContain("status: PASSED");
    expect(result.compressedContent).toContain("BUILD FAILURE");
  });

  it("uses the last Surefire summary and lets its failure override earlier success", () => {
    const output = fixture("maven-surefire-last-summary-failure.txt");

    expect(statusOf(output)).toContain("status: FAILED");
  });

  it("ignores an older failing count when the last global Surefire summary is clean", () => {
    const output = [
      "[INFO] Tests run: 3, Failures: 1, Errors: 0, Skipped: 0",
      "[INFO] Re-running failing tests...",
      "[INFO] Results:",
      "[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0",
      ...Array.from({ length: 40 }, (_, index) => `[DEBUG] surefire report line ${index}`),
    ].join("\n");

    expect(statusOf(output)).toContain("status: PASSED");
  });

  it("accepts an explicit Maven success after a zero-failure final summary", () => {
    const output = fixture("maven-success.txt");

    expect(statusOf(output)).toContain("status: PASSED");
  });

  it("handles ANSI-colored Windows output without allowing success to mask failure", () => {
    const windowsAnsiOutput = fixture("maven-multimodule-build-failure.txt")
      .replace("BUILD FAILURE", "\u001b[1;31mBUILD FAILURE\u001b[0m")
      .replace(/\n/g, "\r\n");

    expect(statusOf(windowsAnsiOutput)).toContain("status: FAILED");
  });

  it("gives a non-zero exit code precedence over BUILD SUCCESS", () => {
    const output = `${fixture("maven-success.txt")}\nProcess finished with exit code 1\n`;

    expect(statusOf(output)).toContain("status: FAILED");
  });

  it("gives a non-zero Errors count precedence over BUILD SUCCESS", () => {
    const output = fixture("maven-success.txt").replace(
      "Tests run: 11, Failures: 0, Errors: 0, Skipped: 0",
      "Tests run: 11, Failures: 0, Errors: 1, Skipped: 0",
    );

    expect(statusOf(output)).toContain("status: FAILED");
  });

  it.each(["<<< FAILURE!", "<<< ERROR!"])(
    "gives the Maven fatal marker %s precedence over BUILD SUCCESS",
    (marker) => {
      const output = `${fixture("maven-success.txt")}\n[ERROR] sample test ${marker}\n`;

      expect(statusOf(output)).toContain("status: FAILED");
    },
  );

  it("returns UNKNOWN when Maven output has no conclusive status", () => {
    const output = [
      "[INFO] Scanning for projects...",
      "[INFO] Building sample-app 1.0.0-SNAPSHOT",
      "[INFO] --- maven-surefire-plugin:3.5.2:test (default-test) @ sample-app ---",
      "[INFO] Running com.example.app.HealthControllerTest",
      ...Array.from({ length: 80 }, (_, index) => `[DEBUG] provider diagnostic line ${index}`),
    ].join("\n");

    expect(statusOf(output)).toContain("status: UNKNOWN");
  });
});
