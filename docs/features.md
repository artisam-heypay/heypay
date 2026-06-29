# HeyPay — Feature Changelog

A running log of completed work, newest entries on top. Each entry references the GitHub issue it closes.

## 2026-06-29 — Fix #11: CSRF / same-origin guard (TDD)

- Added `src/server/auth/csrf.ts`: `assertSameOrigin(req)` rejects cross-origin state-changing requests. Safe methods (GET/HEAD/OPTIONS) always pass. Primary signal is the browser-set `Sec-Fetch-Site` header (`same-origin`/`same-site` allowed, `cross-site` → `forbidden()` 403). When absent, falls back to comparing the `Origin` header against `APP_URL`; a missing or foreign/invalid Origin throws `forbidden()`. Module is `import "server-only"`.
- Re-used the `server-only` Vitest alias + `tests/helpers/server-only-stub.ts` so the guard unit-tests cleanly under Node (shared with the other Sprint 2 auth modules).
- Followed strict TDD: wrote `tests/server/auth/csrf.test.ts` first (RED — module not found), then implemented to GREEN. 5 tests cover safe-method passthrough, same-origin allow, cross-site 403, Origin fallback (foreign rejected / same allowed), and the no-signal rejection.

## 2026-06-29 — Fix #9: argon2id password hashing (TDD)

- Added `src/server/auth/password.ts`: argon2id hashing per the OWASP Password Storage Cheat Sheet (`memoryCost=19456` KiB, `timeCost=2`, `parallelism=1`). Exports `hashPassword(plain)` (encoded `$argon2id$` hash), `verifyPassword(hash, plain)` (returns `false` on any error — malformed hash never throws), and `DUMMY_PASSWORD_HASH`, a precomputed hash of an unknown random value used on the login path to run a `verify()` even for unknown usernames, equalizing response timing against account-enumeration attacks. Module is marked `import "server-only"`; plaintext is never logged or embedded in the hash.
- Added `tests/helpers/server-only-stub.ts` and aliased `server-only` to it in `vitest.config.ts` (`resolve.alias`) so server modules import cleanly under Node during unit tests.
- Followed strict TDD: wrote `tests/server/auth/password.test.ts` first (RED — module not found), then implemented to GREEN. 4 tests cover hash/verify round-trip, wrong-password rejection, malformed-hash returning `false` (not throwing), and the dummy hash verifying to `false`.

## 2026-06-28 — Fix #8: src/lib/http.ts (TDD)

- Added `src/lib/http.ts`: the locked HTTP contract for Route Handlers, built on `next/server` + `zod` and reusing `src/lib/errors.ts` (no duplicated error definitions). Exports the `HandlerContext`/`Handler` types, `json`, `route`, `parseBody`, and `parseQuery`.
- `json(data, status = 200)` is the JSON success helper (`NextResponse.json`). `route(handler)` wraps a handler: awaits Next 16 async `params`, builds a `HandlerContext` (`params`, plus `userId`/`role` as `null` placeholders for Phase 2 auth), and catches thrown errors — `AppError` renders as its `ErrorEnvelope` + status, `ZodError` maps to a 400 `BAD_REQUEST` envelope, and anything else is masked as a 500 `SERVER_ERROR` (full detail logged server-side only, never leaked to the client).
- `parseBody(req, schema)` parses+validates a JSON body (throws `badRequest` on non-JSON or schema failure); `parseQuery(req, schema)` validates `nextUrl.searchParams` (throws `badRequest` on failure). `Role` is imported type-only so it is erased at runtime.
- Followed strict TDD: wrote `src/lib/http.test.ts` first (confirmed RED — module not found), then implemented to GREEN. 10 tests cover `json` status/body, `parseBody` valid/invalid/non-JSON, `parseQuery` present/missing params, and `route` rendering AppError envelopes, ZodError -> 400, awaited param passthrough, and 500 masking that does not leak the internal message.

## 2026-06-28 — Fix #7: src/lib/errors.ts (TDD)

- Added `src/lib/errors.ts`: the locked Errors contract. Exports the `ErrorEnvelope` type (`{ error: { code, message, details? } }`) and the `AppError` class (extends `Error`, carries readonly `code`/`status`/`details`, sets `name = "AppError"`).
- Added the additive `AppError.toEnvelope()` helper that renders an `ErrorEnvelope`, omitting `details` entirely when it is `undefined` (does not change the contract signature).
- Exported the convenience constructors mapping to their HTTP statuses: `badRequest` (400, accepts `details`), `unauthorized` (401), `forbidden` (403), `notFound` (404), `conflict` (409, accepts `details`), `tooManyRequests` (429), and `serverError` (500), each with sensible default messages.
- Followed strict TDD: wrote `src/lib/errors.test.ts` first (confirmed RED — module not found), then implemented to GREEN. 4 tests cover `AppError` field carriage + `instanceof Error`, envelope rendering with/without details, status-code mapping for all constructors, and details passthrough for `badRequest`/`conflict`.

## 2026-06-28 — Fix #6: vitest config + src/lib/money.ts (TDD)

- Added `vitest.config.ts` (node environment, `@/` alias resolved via `vite-tsconfig-paths`, test include globs for `src/**/*.test.ts` and `tests/**/*.test.ts`), wiring up the project's first test suite so `pnpm test` runs.
- Added `src/lib/money.ts`: the locked Money contract built on `decimal.js` (re-exported `Decimal`, global precision headroom of 40 with explicit per-format rounding). Exports `dec` (constructs/validates a `Decimal`, throws on NaN/Infinity), `formatXlm` (7dp half-up), `formatPhp` (2dp half-up), `displayPhp` (`₱` + thousands grouping, sign-aware), `displayXlm` (`… XLM` suffix), `phpToXlm` (php / rate at 7dp ROUND_UP so the payer always covers, throws on non-positive rate), and `availableXlm` (cached minus reserved).
- Followed strict TDD: wrote `src/lib/money.test.ts` first (confirmed RED — module not found), then implemented to GREEN. 10 tests across `dec`, `formatXlm`, `formatPhp`, `displayPhp`/`displayXlm`, `phpToXlm`, and `availableXlm` cover string/number/Decimal construction, NaN/Infinity rejection, exact decimal-place rendering, half-up vs round-up rounding (no float drift), thousands grouping, and the non-positive-rate guard.

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
