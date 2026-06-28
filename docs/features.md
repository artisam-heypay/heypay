# HeyPay — Feature Changelog

A running log of completed work, newest entries on top. Each entry references the GitHub issue it closes.

## 2026-06-28 — Fix #3: Local infra: docker-compose + .env.example

- Added `docker-compose.yml` (dev only) defining Postgres 17, Redis 7, and MinIO services with mapped ports (5432, 6379, 9000/9001) and named volumes (`pgdata`, `miniodata`).
- Added `.env.example` documenting the full environment contract with placeholders only: app/session/encryption, Postgres + shadow DB URLs, Redis, seeded admin, Stellar testnet, payment rail (mock/PDAX), and S3-compatible object storage (MinIO dev).

## 2026-06-28 — Fix #2: Tailwind v4 CSS-first theme, fonts, and root layout

- Added `postcss.config.mjs` wiring the `@tailwindcss/postcss` plugin for Tailwind v4.
- Added `src/app/globals.css` with the full BRAND §9 `@theme` block (brand/surface/status colors, Lexend/Inter font tokens, type scale, radius, spacing), a base layer (background + body font + Material Symbols variation defaults + `.icon-filled`), and `.glass`/`.tonal-card` component utilities plus a reduced-motion guard.
- Added `src/app/layout.tsx`: root layout loading Lexend, Inter, and Material Symbols via Google Fonts links, with HeyPay metadata and themed `<body>` (background + body font).
- Added `src/app/page.tsx`: minimal themed landing page exercising token utilities so the app boots.

## 2026-06-28 — Fix #1: Workspace scaffold & tooling config

- Added pnpm workspace scaffold: `.npmrc`, `package.json` (Next.js 16 / React 19 / TypeScript strict, Node 22 engine, `pnpm` pinned via `packageManager`).
- Defined project scripts: `dev`, `build`, `start`, `worker:dev`, `worker:start`, `typecheck`, `lint`, `format`, `format:check`, `test`.
- Added strict TypeScript config (`tsconfig.json`) with `@/*` path alias and Next.js plugin.
- Added `next.config.ts` declaring native/Node-only `serverExternalPackages` (argon2, @prisma/adapter-pg, pg, ioredis).
- Added ESLint flat config (`eslint.config.mjs`) combining `@eslint/js`, `typescript-eslint`, and `@next/eslint-plugin-next`.
- Added Prettier config (`.prettierrc.json`, `.prettierignore`) and consolidated `.gitignore`.
- Re-pinned all dependencies to the newest stable releases and wrote `pnpm-lock.yaml`.
