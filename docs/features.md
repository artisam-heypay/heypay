# HeyPay — Feature Changelog

A running log of completed work, newest entries on top. Each entry references the GitHub issue it closes.

## 2026-06-29 — Fix #19: AES-256-GCM envelope encryption (TDD)

- Added `src/server/crypto/envelope.ts`: `encryptSecret(plaintext)` / `decryptSecret(payload)` using AES-256-GCM with a self-describing payload `v<version>:<base64 iv>:<base64 tag>:<base64 ciphertext>`. A versioned keyring is built from `ENCRYPTION_MASTER_KEY` (current, format `base64:<32-byte key>`) + `ENCRYPTION_KEY_VERSION`, plus optional historical `ENCRYPTION_MASTER_KEY_V<n>` keys so rotation can still decrypt legacy ciphertext. Random 12-byte IV per call; auth tag verified on decrypt (tamper → throw). `__resetKeyringForTests()` clears the cached keyring. Module is `import "server-only"`.
- Re-used the `server-only` Vitest alias + `tests/helpers/server-only-stub.ts`.
- Followed strict TDD: wrote `tests/server/crypto/envelope.test.ts` first (RED), then implemented to GREEN. 6 tests cover round-trip, distinct IV per call, tampered-tag rejection, malformed-payload rejection, missing-version-key rejection, and rotation (decrypt v1 legacy after rotating to v2).
- Deviation from the plan's verbatim snippet: hardened `decryptSecret` to satisfy the repo's strict TS (`noUncheckedIndexedAccess`) — the `split(":")` parts are destructured and explicitly guarded for `undefined` before use, instead of indexing `parts[0..3]` directly. Behavior is identical; only type-safety was added.
## 2026-06-29 — Fix #22: QRPH CRC-16/CCITT-FALSE (TDD)

- Added `src/server/qrph/crc.ts`: `crc16ccitt(data)` implementing CRC-16/CCITT-FALSE (poly `0x1021`, init `0xFFFF`, no reflection, xorout `0x0000`), returning 4 uppercase hex chars — used to validate/compute the QRPH checksum over the payload up to and including the `6304` tag. `import "server-only"` module.
- Followed strict TDD: wrote `tests/server/qrph/crc.test.ts` first (RED), then implemented to GREEN. 3 tests cover the canonical check value (`"123456789"` → `29B1`), a real PH static QRPH body ending in `6304` (→ `3EAC`), and one-character-change detection.
## 2026-06-29 — Fix #23: Generic EMVCo TLV parser (TDD)

- Added `src/server/qrph/tlv.ts`: `parseTlv(input)` parses a flat EMVCo TLV string (2-char tag, 2-digit length, value) into ordered `TlvNode[]`, throwing on a non-numeric length or a value overrun/truncation. `toMap(nodes)` builds a tag→value map (last occurrence wins). `parseTemplate(value)` parses a nested template value (e.g. the tag-26 merchant-account-info template) into a sub-tag map. `import "server-only"` module.
- Re-used the `server-only` Vitest alias + `tests/helpers/server-only-stub.ts`.
- Followed strict TDD: wrote `tests/server/qrph/tlv.test.ts` first (RED), then implemented to GREEN. 4 tests cover ordered top-level parsing of a real static QRPH body, the nested tag-26 template (GUI + merchant id), length-overrun rejection, and non-numeric-length rejection.
## 2026-06-29 — Fix #28: retry / timeout / circuit-breaker resilience utilities (TDD)

- Added `src/lib/retry.ts`: a dependency-free resilience toolkit used to wrap external calls (PDAX in Sprint 4, worker jobs in Phase 5). `withTimeout(p, ms)` races a promise against a per-attempt timeout (`TimeoutError`; `ms <= 0` disables). `withRetry(fn, opts)` retries with exponential backoff + full jitter (`retries`/`baseMs`/`maxMs`/`timeoutMs`/`jitter`/`isRetryable`), with injectable `sleepImpl`/`randomImpl` for deterministic tests; throws the last error after exhausting retries or on a non-retryable error. `CircuitBreaker` (`closed`/`open`/`half-open`) opens after `failureThreshold` failures, fast-fails with `CircuitOpenError` while open, half-opens after `resetMs`, and closes again on the next success (injectable `nowImpl`).
- Followed strict TDD: wrote `tests/lib/retry.test.ts` first (RED), then implemented to GREEN. 9 tests cover retry success-after-failures, give-up-and-throw-last, `isRetryable=false`, per-attempt timeout, exponential+capped backoff sequence, `withTimeout` win/lose races, and circuit-breaker open/fast-fail + half-open→close.
## 2026-06-29 — Fix #29: deterministic MockProvider (TDD)

- Added `src/server/rails/mock.ts`: a fully deterministic `PaymentRailProvider` for local/CI runs and Phase 5 tests. `createMockProvider(cfg?)` returns a fresh instance with isolated in-memory state; `mockProvider` is the env-wired singleton. Configurable `rate` (`MOCK_XLM_PHP_RATE`, default `3.50`), `delayMs` (`MOCK_RAIL_DELAY_MS`, default `0`), and `feeRate` (`MOCK_RAIL_FEE_RATE`, default `0.01`). No `Math.random`: trade/payout refs are derived from the input ref (`MOCK-TRADE-…` / `MOCK-PAYOUT-…`), and status transitions are driven by an internal poll counter (first poll → `PENDING`, next → terminal). Any `ref` containing `FAIL` forces the `FAILED` branch so the worker can exercise FAILED/REFUND. All math is `Decimal`: `getQuote` uses `phpToXlm` (ROUND_UP 7dp) with a ~90s expiry; `filledPhp = xlmAmount * rate` (2dp), `feePhp = filledPhp * feeRate` (2dp); payout `netPhp` equals the cash-out amount. `import "server-only"` module.
- Followed strict TDD: wrote `tests/server/rails/mock.test.ts` first (RED), then implemented to GREEN. 6 tests cover quote math/expiry, deterministic tradeRef, PENDING→FILLED with PHP fee, PENDING→SETTLED payout, and both forced-failure paths.

## 2026-06-29 — Fix #27: PaymentRailProvider interface + contract types (TDD)

- Added `src/server/rails/provider.ts`: the locked payment-rail contract (verbatim from the master overview) — `Quote`, `TradeResult`, `TradeStatus`, `BankPayout`, `PayoutResult`, `PayoutStatus`, and the `PaymentRailProvider` interface with its five methods (`getQuote`, `sellCryptoForPhp`, `getTradeStatus`, `cashOutPhpToBank`, `getPayoutStatus`). Types-only, no runtime logic; consumed by the Mock/PDAX providers (Tasks 3–4) and the Phase 5 worker. All amounts are `Decimal`.
- Followed strict TDD: wrote `tests/server/rails/provider.types.test.ts` first (RED), then implemented to GREEN. 4 tests (incl. `expectTypeOf` checks) lock the `Decimal`/`Date` shape of `Quote`, the `TradeStatus`/`PayoutStatus` state unions, and that `PaymentRailProvider` exposes exactly the five methods.
## 2026-06-29 — Fix #11: CSRF / same-origin guard (TDD)

- Added `src/server/auth/csrf.ts`: `assertSameOrigin(req)` rejects cross-origin state-changing requests. Safe methods (GET/HEAD/OPTIONS) always pass. Primary signal is the browser-set `Sec-Fetch-Site` header (`same-origin`/`same-site` allowed, `cross-site` → `forbidden()` 403). When absent, falls back to comparing the `Origin` header against `APP_URL`; a missing or foreign/invalid Origin throws `forbidden()`. Module is `import "server-only"`.
- Re-used the `server-only` Vitest alias + `tests/helpers/server-only-stub.ts` so the guard unit-tests cleanly under Node (shared with the other Sprint 2 auth modules).
- Followed strict TDD: wrote `tests/server/auth/csrf.test.ts` first (RED — module not found), then implemented to GREEN. 5 tests cover safe-method passthrough, same-origin allow, cross-site 403, Origin fallback (foreign rejected / same allowed), and the no-signal rejection.

## 2026-06-29 — Fix #9: argon2id password hashing (TDD)

- Added `src/server/auth/password.ts`: argon2id hashing per the OWASP Password Storage Cheat Sheet (`memoryCost=19456` KiB, `timeCost=2`, `parallelism=1`). Exports `hashPassword(plain)` (encoded `$argon2id$` hash), `verifyPassword(hash, plain)` (returns `false` on any error — malformed hash never throws), and `DUMMY_PASSWORD_HASH`, a precomputed hash of an unknown random value used on the login path to run a `verify()` even for unknown usernames, equalizing response timing against account-enumeration attacks. Module is marked `import "server-only"`; plaintext is never logged or embedded in the hash.
- Added `tests/helpers/server-only-stub.ts` and aliased `server-only` to it in `vitest.config.ts` (`resolve.alias`) so server modules import cleanly under Node during unit tests.
- Followed strict TDD: wrote `tests/server/auth/password.test.ts` first (RED — module not found), then implemented to GREEN. 4 tests cover hash/verify round-trip, wrong-password rejection, malformed-hash returning `false` (not throwing), and the dummy hash verifying to `false`.
## 2026-06-29 — Fix #10: server-side sessions (TDD, integration)

- Added `src/server/auth/sessions.ts`: the locked Auth/sessions contract. Opaque 256-bit token (`randomBytes(32)` base64url); only the SHA-256 token **hash** is stored in `Session` (raw token never persisted). `createSession` sets an HttpOnly + SameSite=Lax cookie (`heypay_session`, Secure in production) and writes ip/userAgent. `getSessionUser`/`requireUser`/`requireRole` validate the cookie (expired or inactive-user → null/throw), with sliding renewal when <½ TTL remains. `lookupSession(token)` is a raw-token variant for `proxy.ts` (Task 9). `destroySession` deletes the row and clears the cookie. `import "server-only"` module.
- Test infrastructure: `tests/helpers/mock-cookies.ts` (in-memory `next/headers` cookie jar via `vi.mock`), `tests/helpers/db.ts` (`resetDb` TRUNCATE of auth tables), and wired Vitest to load `.env` (`setupFiles: ["dotenv/config"]`) so integration tests reach the docker-compose Postgres.
- Followed strict TDD: wrote `tests/server/auth/sessions.test.ts` first (RED), then implemented to GREEN against the live Postgres. 6 tests cover hash-only persistence + cookie, valid-cookie resolution, missing-cookie null, expired-session null, `requireRole` 403 mismatch, and `destroySession` revocation.
- Deviation: Sprint 1's `src/server/db.ts` exported the client as `prisma`, but the locked contract (and every Phase 2+ consumer) imports `db` from `@/server/db`. Added an additive `export const db = prisma;` alias — existing `prisma` consumers are unaffected.
## 2026-06-29 — Fix #12: Redis token-bucket rate limiter (TDD)

- Added `src/server/auth/rate-limit.ts`: `rateLimit(key, { limit, windowSec })` enforces a per-identity token bucket on the `redis` singleton. Refill + consume is one atomic Lua `EVAL` (HMGET tokens/ts → refill by elapsed × rate, capped at capacity, consume one, HSET, PEXPIRE) so concurrent requests can't race the bucket. Throws `tooManyRequests()` (429) when the bucket is empty. `import "server-only"` module.
- Added `tests/helpers/fake-redis.ts`: an in-memory ioredis stand-in (get/set/del/incr/expire + a token-bucket `eval` emulation) for deterministic unit tests.
- Followed strict TDD: wrote `tests/server/auth/rate-limit.test.ts` first (RED), then implemented to GREEN. 3 tests cover allow-up-to-limit-then-429, refill after the window elapses (mocked clock), and per-key independence.
- Deviation: the plan's test factory closed over a top-level `fake` variable, which Vitest's hoisted `vi.mock` cannot reference (`Cannot access 'fake' before initialization`). Reworked the mock to construct the fake inside the factory and retrieve that same instance via the mocked import — behavior identical, hoisting-safe.
## 2026-06-29 — Fix #13: best-effort audit logging (TDD)

- Added `src/server/auth/audit.ts`: `audit(input)` writes an `AuditLog` row (`actorId`/`action`/`target`/`metadata`/`ip`, nullable fields normalized to `null`, `metadata` cast to `Prisma.InputJsonValue`). Wrapped in try/catch so audit failures **never throw into the request path** — on error it logs only the action name (never the metadata, which may carry sensitive context). `import "server-only"` module.
- Followed strict TDD: wrote `tests/server/auth/audit.test.ts` first (RED), then implemented to GREEN. 2 tests cover the exact `create` payload (actor/target/ip, `metadata: undefined`) and that a rejected DB write is swallowed without throwing.
- Deviations (both test-only, behavior unchanged): the plan's `vi.mock` factory referenced a top-level `create` spy → reworked via `vi.hoisted` so it's hoisting-safe; and the "swallows errors" case uses `mockRejectedValueOnce` + a manual try/catch (the persistent `mockRejectedValue` left a floating rejected promise that Vitest reports as an unhandled rejection).
- Also added the additive `export const db = prisma` alias in `src/server/db.ts` (locked contract imports `db` from `@/server/db`; Sprint 1 exported only `prisma`).

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
