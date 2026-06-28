# HeyPay — Feature Changelog

A running log of completed work, newest entries on top. Each entry references the GitHub issue it closes.

## 2026-06-28 — Fix #5: Idempotent seed (admin + optional demo)

- Added `prisma/seed.ts` (run via the `prisma.config.ts` seed wiring `tsx prisma/seed.ts`): a self-contained seed using its own `@prisma/adapter-pg`-backed `PrismaClient` and an inline argon2id `hashPassword` helper (Phase 2 will centralize hashing).
- Admin upsert is idempotent: reads `ADMIN_USERNAME`/`ADMIN_PASSWORD` from env (defaults `admin` / placeholder in `.env`), upserts on the unique `username`, and re-asserts `role: ADMIN` + `isActive: true` on update so re-runs never create duplicates or drift.
- Demo data (demo payer + demo merchant with a sample decoded QRPH and masked test bank account) is gated behind `SEED_DEMO=true` and seeded via `upsert`, so it is opt-in and idempotent.
- Stubbed Phase-3 dependencies behind the gate: the demo payer's custodial testnet wallet (friendbot funding via `walletService`) and the demo merchant's envelope-encrypted `accountNumber` (`encryptSecret`) use placeholder values (`stub:encrypt-in-phase3`) so the seed succeeds today; Phase 3 replaces them.
- Verified against the live docker Postgres: `pnpm prisma db seed` run twice yields no duplicate-key errors and a stable row set (1 admin, 1 demo payer, 1 demo merchant + 1 Merchant row); the `SEED_DEMO=false` path seeds the admin only.

## 2026-06-28 — Fix #4: Prisma 7 schema, config, client/redis singletons, first migration

- Added `prisma/schema.prisma` with the complete SPEC §4 data model: enums (`Role`, `PaymentAsset`, `PaymentStatus`, `WalletTxType`, `MerchantStatus`) and models (`User`, `Session`, `CustodialWallet`, `WalletTransaction`, `Merchant`, `ExchangeRateSnapshot`, `Payment`, `PaymentEvent`, `AuditLog`, `IdempotencyKey`), using the Prisma 7 Rust-free `prisma-client` generator with output to `src/generated/prisma`.
- Added `prisma.config.ts` (Prisma 7 config): loads env via `dotenv`, points to the schema, wires the seed command (consumed in Task 5), and carries the connection `url` + `shadowDatabaseUrl` (Prisma 7 moved these out of `schema.prisma` into the config; the `datasource` block now only declares `provider`).
- Added `src/server/db.ts`: server-only Prisma client singleton using the `@prisma/adapter-pg` driver adapter.
- Added `src/server/redis.ts`: server-only `ioredis` singleton with `maxRetriesPerRequest: null` (BullMQ-ready for later phases).
- Generated and applied the first migration `prisma/migrations/20260628131155_init/` against the docker Postgres (all tables + enums created).
- Mapped `@/generated/prisma` → the generated `client.ts` entry in `tsconfig.json` (the Prisma 7 generator emits no barrel `index.ts`), keeping the locked import specifier stable for downstream tasks.
- Added `docs/migrations.md` documenting migration naming/timestamp conventions, how to add a migration, `migrate deploy` for CI/prod, offline `migrate diff`, and the shadow-database setup.

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
