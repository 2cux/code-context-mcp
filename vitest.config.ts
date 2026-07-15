import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@compression": resolve(process.cwd(), "src/compression"),
      "@memory": resolve(process.cwd(), "src/memory"),
      "@storage": resolve(process.cwd(), "src/storage"),
      "@utils": resolve(process.cwd(), "src/utils"),
      "@receipts": resolve(process.cwd(), "src/receipts"),
      "@fixtures": resolve(process.cwd(), "fixtures"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/cli/**"],
    },
  },
});
