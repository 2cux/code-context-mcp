const { spawnSync } = require("node:child_process");
const path = require("node:path");

const vitest = path.join("node_modules", "vitest", "vitest.mjs");
const result = spawnSync(process.execPath, [vitest, "run", "tests/quality/generateQualityReports.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, CODECONTEXT_GENERATE_QUALITY_REPORTS: "1" },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
