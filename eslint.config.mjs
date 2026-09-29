import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/generated/**",
      "src/server/stellar/escrow-bindings/**",
      "prisma/migrations/**",
      "pnpm-lock.yaml",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Operator scripts run under plain Node, not Next's browser-ish env.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        URLSearchParams: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
  {
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Node.js scripts run outside Next — give them the Node runtime globals.
    files: ["scripts/**/*.{js,mjs,cjs}", "*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
  },
  {
    // Landing-page scripts are plain browser JS served as-is (no bundler).
    files: ["homepage/**/*.js"],
    languageOptions: {
      globals: { window: "readonly", document: "readonly", localStorage: "readonly" },
    },
  },
);
