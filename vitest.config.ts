import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "node",
    // .tsx component tests run in jsdom; .ts unit/integration tests stay in node.
    environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]],
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "packages/*/src/**/*.test.ts",
    ],
    globals: false,
    setupFiles: ["./tests/helpers/setup.ts", "./tests/helpers/setup-dom.ts"],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./tests/helpers/server-only-stub.ts", import.meta.url)),
    },
  },
});
