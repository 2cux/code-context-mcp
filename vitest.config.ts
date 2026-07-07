import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@compression": resolve(__dirname, "src/compression"),
      "@memory": resolve(__dirname, "src/memory"),
      "@storage": resolve(__dirname, "src/storage"),
      "@utils": resolve(__dirname, "src/utils"),
      "@receipts": resolve(__dirname, "src/receipts"),
      "@fixtures": resolve(__dirname, "fixtures"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/cli/**"],
    },
  },
});
