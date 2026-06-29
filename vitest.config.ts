import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // The real `server-only` package throws when imported outside an RSC bundle.
      // Alias it to a no-op stub so server modules can be unit-tested under Node.
      "server-only": fileURLToPath(new URL("./tests/helpers/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globals: false,
    // Load .env (DATABASE_URL, REDIS_URL, ENCRYPTION_*) so integration tests can
    // reach the local docker-compose services.
    setupFiles: ["dotenv/config"],
  },
});
