import { describe, expect, it } from "vitest";
import { generateQualityReports } from "./generateBaseline.js";

const enabled = process.env.CODECONTEXT_GENERATE_QUALITY_REPORTS === "1";

(enabled ? describe : describe.skip)("generate current quality reports", () => {
  it("writes reproducible quality reports", async () => {
    const report = await generateQualityReports();
    expect(report.meta.command).toBe("npm run quality:reports");
    expect(["PASS", "FAIL"]).toContain(report.releaseGateResult.verdict);
  });
});
