# HeyPay — Feature Changelog

A running log of completed work, newest entries on top. Each entry references the GitHub issue it closes.

## 2026-06-30 — Fix #41: worker entrypoint (`src/worker/index.ts`) (boot-verified)

- Added `src/worker/index.ts`: the long-running settlement worker. On start it bootstraps the S3/MinIO bucket (`ensureBucket`), then spins up three BullMQ `Worker`s on the shared connection — `settle` (concurrency 5, runs `processSettleJob`), `deposit-poll` (concurrency 1, `processDepositPollJob`), `reconcile` (concurrency 1, `processReconcileJob`) — logging failed jobs. It registers two repeatable schedules (deposit-poll every 30s, reconcile every 5m, each pinned by a single `jobId`) and wires graceful shutdown on `SIGTERM`/`SIGINT` (close all workers, quit Redis, exit 0).
- Updated the `worker:dev`/`worker:start` scripts to run under **`node --conditions=react-server`** so the `server-only` guard resolves to its no-op in the standalone Node process (without the condition, `import "server-only"` throws outside a React Server bundle and the worker can't boot). bullmq `connection` is cast (its bundled ioredis types differ from the app's), matching `queues.ts`.
- No unit test (thin wiring; the job processors are unit-tested and the full flow is covered by Phase 9 e2e). **Boot-verified locally**: `[worker] started: settle, deposit-poll, reconcile` with the repeatable deposit-poll firing, then a clean signal shutdown.

## 2026-06-30 — Fix #40: reconciliation job (`jobs/reconcile.ts`) (TDD)

- Added `src/server/queue/jobs/reconcile.ts`: `processReconcileJob()` diffs each custodial wallet's `cachedXlmBalance` against the live Horizon balance (`walletService.getBalance`). Any mismatch is **flagged** to the audit log as `reconcile.drift` (with public key, cached/horizon/delta XLM) — drift is never auto-corrected (SPEC §9). A failed `getBalance` for one wallet is logged and skipped, not fatal. Returns `{ checked, drift }`. PHP/PDAX reconciliation is left as a `TODO(pdax-reconcile)` (the locked `PaymentRailProvider` exposes no transaction-listing method yet). `import "server-only"` module.
- Followed strict TDD: wrote `src/server/queue/jobs/reconcile.test.ts` first (RED), then implemented to GREEN against the live Postgres (`getBalance` mocked). 2 tests cover a cached/Horizon mismatch flagging one `reconcile.drift` audit entry and a matching balance flagging none.

## 2026-06-30 — Fix #39: deposit poller (`jobs/deposit-poller.ts`) (TDD)

- Added `src/server/queue/jobs/deposit-poller.ts`: `syncWalletDeposits(walletId)` syncs a custodial wallet's incoming Horizon payments into `PREFUND_DEPOSIT` rows and bumps `cachedXlmBalance`. The Horizon cursor is persisted in **Redis** (`horizon:cursor:<walletId>`) — no schema change — and passed back on each call. Each deposit is **idempotent by `stellarTxHash`** (unique on `WalletTransaction`; pre-checked and P2002-guarded inside the credit transaction), so re-seeing the same payment never double-credits. Updates `lastSyncedAt` each run and returns `{ balanceXlm, newDeposits }`. `processDepositPollJob()` runs the sync across every wallet, isolating per-wallet failures. `import "server-only"` module.
- Followed strict TDD: wrote `src/server/queue/jobs/deposit-poller.test.ts` first (RED), then implemented to GREEN against the live Postgres (wallet + redis mocked). 2 tests cover crediting a new deposit exactly once across two runs (one `PREFUND_DEPOSIT`, balance 25, `lastSyncedAt` set) and passing the persisted cursor on the subsequent call.

## 2026-06-30 — Fix #38: worker settlement processor (`jobs/settle.ts`) (TDD)

- Added `src/server/queue/jobs/settle.ts`: `processSettleJob({ data: { paymentId } })` advances a payment **one edge** of the settlement state machine then re-enqueues the next step (resumable + idempotent per status, never throws on terminal states). Steps: `AUTHORIZED → STELLAR_SUBMITTED` (`walletService.sendXlm` to `PDAX_XLM_DEPOSIT_ADDRESS`, memo = reference) → `STELLAR_CONFIRMED` (`confirmTx`; on success writes the single `PAYMENT_DEBIT`, debits `cachedXlmBalance` + releases the reservation; on a never-landed tx → `FAILED` + release, no debit) → `PDAX_TRADING` (`rail.sellCryptoForPhp`) → `PDAX_TRADED` (`pollUntil` trade FILLED, records fee) → `PAYOUT_SUBMITTED` (`rail.cashOutPhpToBank`, merchant bank account decrypted in-memory) → `SETTLED` (`pollUntil` payout SETTLED, records `netSettledPhp`/`settledAt`). External calls use `withRetry`; trade/payout settlement uses `pollUntil`. Failure routing: a failure **before** XLM moves → `FAILED` (+ release reservation); a failure **after** XLM moved (`XLM_MOVED`) → `REFUND_PENDING`, and the refund step credits the payer with a single `REFUND_CREDIT` → `REFUNDED` + a `payment.refunded` audit alert. Each side-effect step guards against re-execution (≤1 `PAYMENT_DEBIT`, ≤1 `REFUND_CREDIT`). `import "server-only"` module.
- Followed strict TDD: wrote `src/server/queue/jobs/settle.test.ts` first (RED), then implemented to GREEN against the live Postgres (wallet/rail/queues mocked). 3 tests drive the full lifecycle: AUTHORIZED→SETTLED (exactly one debit, reservation released, balance `100 − 8.3333434`, decrypted bank account passed to the rail), Stellar-confirm-failure→FAILED (no debit, reservation released, no trade attempted), and post-Stellar trade-failure→REFUND_PENDING→REFUNDED (one debit + one credit + admin alert + event trail).
- Deviation: dropped the plan snippet's `{ label }` arg on the `withRetry` calls (shipped `RetryOptions` has no `label`); test spies created via `vi.hoisted`.

## 2026-06-30 — Fix #36: confirm domain (`confirmPayment`) (TDD)

- Added `src/server/payments/confirm.ts`: `confirmPayment({paymentId, payerId, idemKey})` authorizes a `QUOTED` payment. Wrapped in `withIdempotencyKey` (`payment.confirm` scope) so a retried confirm replays the same result. Enforces ownership (`forbidden` 403 for another user's payment), status (`QUOTED` only; an already-`AUTHORIZED` payment returns idempotently; other statuses → `conflict` 409), and quote freshness (expired → `conflict` 409). In one transaction it re-reads the wallet, checks `availableXlm ≥ amountXlm + networkFeeXlm` (else 409), **reserves** that total on `CustodialWallet.reservedXlm`, and `applyTransition`s `QUOTED → AUTHORIZED` (writing the event). After commit it calls `enqueueSettle(paymentId)` to hand off to the settlement worker. `import "server-only"` module.
- Followed strict TDD: wrote `src/server/payments/confirm.test.ts` first (RED), then implemented to GREEN against the live Postgres (`enqueueSettle` mocked). 4 tests cover the happy path (reserve + AUTHORIZED event + enqueue), expired-quote 409 (nothing reserved, nothing enqueued), idempotent double-confirm with the same key (reserves once, enqueues once), and the 403 on another user's payment.
- Deviation (test-only): the `enqueueSettle` `vi.mock` spy is created via `vi.hoisted` and typed `(id: string) => Promise<void>`.

## 2026-06-30 — Fix #37: pollUntil + BullMQ queues + enqueueSettle (TDD)

- Extended `src/lib/retry.ts` with `pollUntil(fn, done, opts?)`: calls `fn` until `done(value)` is true (default 30 attempts × 1s), returning the last value or throwing a labelled timeout. (`withRetry`/`withTimeout`/`CircuitBreaker` from Sprint 4 are unchanged and remain covered by `tests/lib/retry.test.ts`.)
- Added `src/server/queue/queues.ts`: the locked queue layer over **BullMQ** on a shared `ioredis` connection (`maxRetriesPerRequest: null`). `QUEUE_NAMES` (`settle`/`deposit-poll`/`reconcile`), the three `Queue` singletons (exponential backoff, bounded `removeOnComplete/Fail`), `bullConnection`, and `enqueueSettle(paymentId)` which enqueues the next settlement step with **`jobId = \`${paymentId}:${status}\``** so BullMQ dedupes a repeat of the same step (idempotent worker hand-off). `import "server-only"`module. Installed`bullmq`.
- Followed strict TDD: wrote `src/lib/retry.test.ts` (pollUntil) and `src/server/queue/queues.test.ts` (RED), then implemented to GREEN. 4 tests cover pollUntil resolve/timeout and the `QUEUE_NAMES` contract + the `paymentId:status` jobId (bullmq + ioredis mocked).
- Deviations (test-only): bullmq/ioredis mocks use **classes** (queues.ts constructs them with `new`, and Vitest can't `new` an arrow-function mock impl); the bullmq `connection` is cast (its bundled ioredis types differ from the app's). Reordered ahead of #36 confirm, which imports `enqueueSettle`.

## 2026-06-30 — Fix #35: quote domain (`createQuote`) (TDD)

- Added `src/server/payments/quote.ts`: `createQuote({payerId, merchantId, amountPhp})` locks an XLM→PHP rate and opens a `QUOTED` payment. Verifies the merchant is `ACTIVE` (else `notFound` 404) and the payer wallet exists; fetches the rate via `rail.getQuote` wrapped in `withRetry`; computes `amountXlm = phpToXlm(amountPhp, rate)` (ROUND_UP 7dp so the payer covers) plus the `STELLAR_BASE_FEE_XLM` (0.0000100 XLM); checks `availableXlm = cached − reserved ≥ required` (else `conflict` 409, no payment created). In one transaction it writes an `ExchangeRateSnapshot`, the `Payment` (`status QUOTED`, fresh `TXN-` reference, quoted rate/amounts/expiry), and the `CREATED → QUOTED` `PaymentEvent`. `import "server-only"` module.
- Followed strict TDD: wrote `src/server/payments/quote.test.ts` first (RED), then implemented to GREEN against the live Postgres (`rail` mocked at rate 12). 3 tests cover the happy path (ROUND_UP amount + base fee + persisted QUOTED payment + snapshot + event), insufficient-funds 409 (no payment row), and non-ACTIVE-merchant 404.
- Note: dropped the plan snippet's `{ label }` option on the `withRetry` call — the shipped `RetryOptions` (Sprint 4) has no `label` field, so passing it would fail strict typecheck; behavior is unchanged.

## 2026-06-30 — Fix #34: settlement state machine (TDD)

- Added `src/server/payments/state-machine.ts`: the authoritative `Payment` lifecycle. `TRANSITIONS` is the legal edge table (`CREATED → QUOTED → AUTHORIZED → STELLAR_SUBMITTED → STELLAR_CONFIRMED → PDAX_TRADING → PDAX_TRADED → PAYOUT_SUBMITTED → SETTLED`; pre-XLM failures → `FAILED`; once XLM has left the wallet, failures branch `… → REFUND_PENDING → REFUNDED`). `TERMINAL` (`SETTLED`/`FAILED`/`REFUNDED`), `XLM_MOVED` (states where XLM already left), `canTransition`, `isTerminal`, and `nextStep` (happy-path successor for the worker, or `null`). `applyTransition(client, payment, toStatus, detail?)` validates the edge (throws `conflict()` 409 on an illegal one), updates `Payment.status`, and writes a `PaymentEvent` — accepts any `Prisma.TransactionClient`, so callers pass `db` outside a tx or `tx` inside `db.$transaction`. `import "server-only"` module.
- Followed strict TDD: wrote `src/server/payments/state-machine.test.ts` first (RED), then implemented to GREEN. 7 tests cover the full happy-path `nextStep` chain, legal/illegal `canTransition` edges, the refund-only-after-XLM-moved rule, the terminal set, every `PaymentStatus` having a `TRANSITIONS` key, and (persisted) a legal transition writing one `PaymentEvent` + an illegal transition throwing 409 with no event.

## 2026-06-30 — Fix #32: payment reference generator (TDD)

- Added `src/server/payments/reference.ts`: `newPaymentReference()` returns a human-facing `TXN-` + 8 uppercase RFC 4648 base32 chars (`randomBytes(8)` mapped through the base32 alphabet). `import "server-only"` module. First task of Sprint 5 (payments + settlement worker).
- Followed strict TDD: wrote `src/server/payments/reference.test.ts` first (RED), then implemented to GREEN. 2 tests cover the `^TXN-[A-Z2-7]{8}$` format and practical uniqueness across 5000 calls.

## 2026-06-30 — Fix #33: idempotency helper + test DB factories (TDD)

- Added `src/server/payments/idempotency.ts`: `withIdempotencyKey(key, scope, fn, opts?)` runs `fn` exactly once per `(scope, key)` and stores its JSON result in `IdempotencyKey`. It **atomically claims** the key with a `create` (unique `scope:key`); on a `P2002` collision it returns the stored `response` if present (replay) or throws `conflict()` (409) when a row exists with no response yet (a concurrent call is in flight). A missing key throws `badRequest()` (400). Default TTL 24h. `import "server-only"` module.
- Expanded `tests/helpers/db.ts` into the shared payments test kit: `resetDb()` now `deleteMany`s every table in FK-safe order, plus `makePayer({cachedXlm, reservedXlm})` (user + funded `CustodialWallet`) and `makeMerchant({status, accountNumber})` (user + ACTIVE `Merchant` with encrypted bank account) factories reused by later Sprint 5 tasks.
- Followed strict TDD: wrote `src/server/payments/idempotency.test.ts` first (RED), then implemented to GREEN against the live Postgres. 4 tests cover run-once-then-replay, scope isolation, the concurrent-in-flight 409, and the missing-key 400. Full suite (146) stays green after the `resetDb` rewrite.

## 2026-06-29 — Fix #31: rail selection (`rails/index.ts`) (TDD)

- Added `src/server/rails/index.ts`: `selectRail(name?)` returns `pdaxProvider` for `"pdax"` and `mockProvider` otherwise; `rail` is the env-wired singleton (`selectRail(process.env.PAYMENT_RAIL)`), **defaulting to mock** so the full happy path runs locally/CI without PDAX credentials. Re-exports the `PaymentRailProvider` type for downstream consumers. `import "server-only"` module. Completes the Sprint 4 rail layer.
- Followed strict TDD: wrote `tests/server/rails/index.test.ts` first (RED), then implemented to GREEN. 3 tests cover pdax selection, mock selection, and the default-to-mock fallback for unset/unknown values.

## 2026-06-29 — Fix #30: PdaxProvider — HMAC signer, TOTP, Zod-validated, retried (TDD)

- Added `src/server/rails/pdax.ts`: the real `PaymentRailProvider` over the PDAX v1 REST API. `signRequest()` (pure) builds the `Access-Key` + `Access-Signature` (HMAC-SHA256 over `timestamp + method + path + body`, SPEC §7.2). `generateTotp()` (pure, RFC 6238 SHA-1, base32 secret, 6-digit/30s defaults) derives the crypto-withdrawal OTP. `createPdaxProvider(overrides?)` builds an instance with injectable `fetchImpl`/`now`/retry knobs (env-defaulted): `getQuote` (`GET /rates/XLMPHP` → Decimal rate + `phpToXlm`), `sellCryptoForPhp` (`POST /trades` XLM→PHP sell), `getTradeStatus`/`getPayoutStatus` (status mapping), `cashOutPhpToBank` (`POST /cash_out`, **no OTP**), and `withdrawCryptoForRefund` (`POST /crypto_withdrawals` **with** `Access-Otp` TOTP — refund path only). Every call goes through `withRetry` (retries network/5xx, **not** 4xx) and every response is parsed with Zod (untrusted). `import "server-only"`.
- Followed strict TDD: wrote `tests/server/rails/pdax.test.ts` first (RED), then implemented to GREEN. 11 tests cover the HMAC signature vector, the RFC 6238 TOTP vector (`287082` at T=59s), all five provider method mappings, OTP present on refund / absent on PHP cash-out, 5xx-retry-then-succeed, 4xx-no-retry-throw, and malformed-response (schema) rejection.
- Deviation (test-only): typed the `fetch` mocks as `vi.fn<typeof fetch>()` so `mock.calls[i]` is the real `[url, init]` tuple under strict TS (`noUncheckedIndexedAccess`).

## 2026-06-29 — Fix #25: QRPH merchant resolution (TDD)

- Added `src/server/qrph/resolve.ts`: `resolveMerchant(decoded)` finds the registered **ACTIVE** merchant for a decoded QRPH — matches on `qrphRaw` (exact raw string) OR, when present, `qrphMerchantId`, scoped to `status = ACTIVE`. Returns the `Merchant` or `null`. `import "server-only"` module.
- Followed strict TDD: wrote `tests/server/qrph/resolve.test.ts` first (RED), then implemented to GREEN (db mocked). 3 tests cover a matching ACTIVE merchant (asserting the `status`/`OR` query shape), a miss → `null`, and the raw-only OR clause when no `merchantId` is decoded.
- Deviation (test-only): the db `vi.mock` spy is created via `vi.hoisted` so the hoisted factory can reference it.

## 2026-06-29 — Fix #24: QRPH decode (semantics + CRC/currency validation + image) (TDD)

- Added `src/server/qrph/decode.ts`: `decodeQrph(raw)` validates the trailing CRC tag (`6304` + 4 hex) via `crc16ccitt` over everything up to and including `6304`, parses the EMVCo TLV (`parseTlv`/`toMap`), and maps the semantic fields into `QrphDecoded` — payload format (00), point-of-init (01: 11=static / 12=dynamic), merchant name (59) / city (60) / country (58, default PH), currency (53), dynamic amount (54), plus acquirer GUI + merchant id pulled from the merchant-account-info templates (tags 26–51). Throws `badRequest` on a missing CRC tag, CRC mismatch, malformed TLV, or a non-PHP currency (must be `608`). `decodeQrphImage(buf)` decodes an uploaded PNG/JPEG to raw RGBA pixels with `sharp`, reads the QR string with `jsQR`, then runs `decodeQrph`. `import "server-only"` module.
- Installed `jsqr` + `sharp` (runtime) and `qrcode` + `@types/qrcode` (dev, to synthesise a scannable QR fixture in the test).
- Followed strict TDD: wrote `tests/server/qrph/decode.test.ts` first (RED), then implemented to GREEN. 7 tests cover a valid static QRPH (all fields), a dynamic QRPH (amount extraction), bad-CRC rejection, foreign-currency rejection, missing-CRC rejection, round-tripping a rendered QR image, and the no-QR-in-image error.
- Deviation: hardened `decodeQrphImage` to treat an unreadable/corrupt image (e.g. a `sharp`/libpng decode error) as "no QR found" (→ `badRequest`) rather than letting the raw decode error escape — the plan's malformed test fixture exercises exactly this path.

## 2026-06-29 — Fix #26: S3/MinIO storage (presign, magic-byte verify, signed GET, bucket bootstrap) (TDD)

- Added `src/server/storage/s3.ts`: a lazily-cached `S3Client` (env-configured: endpoint, region, path-style, credentials). `presignUpload({prefix, contentType, maxBytes})` issues a presigned POST under a random `prefix/uuid.ext` key, allowing only `image/png`/`image/jpeg` and enforcing a server-side `content-length-range` + `Content-Type` policy (5-min expiry). `verifyUploadedObject(key)` HEADs the object (rejects empty/oversize, 5 MiB cap), GETs the first bytes, and validates **magic bytes** (PNG/JPEG) — rejecting anything else with `badRequest`. `signedGetUrl(key)` returns a 5-min signed GET URL. `ensureBucket()` creates the configured bucket if a HEAD 404s (MinIO bootstrap on app/worker start). `__resetS3ForTests()` drops the cached client. `import "server-only"` module.
- Installed `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, `@aws-sdk/s3-request-presigner` (runtime) and `aws-sdk-client-mock` (dev).
- Followed strict TDD: wrote `tests/server/storage/s3.test.ts` first (RED), then implemented to GREEN with `aws-sdk-client-mock`. 7 tests cover the random-key + size-bounded presign policy, unsupported-content-type rejection, PNG acceptance, non-image magic-byte rejection, oversize rejection, and bucket create-if-missing vs no-op-if-exists.
- Deviation (test-only): the `createPresignedPost` `vi.mock` spy is created via `vi.hoisted` (hoisting-safe).

## 2026-06-29 — Fix #18: (auth) UI — login / signup / logout with Server Actions (TDD)

- Added `src/lib/auth-redirect.ts` (pure): `dashboardPath(role)` maps `PAYER`/`MERCHANT`/`ADMIN` to `/payer/dashboard`, `/merchant/dashboard`, `/admin`.
- Added `src/app/(auth)/actions.ts` (`"use server"`): `loginAction` and `signupAction` (`useActionState` shape `{ error? }`) re-use the auth toolkit directly — Zod validation, per-IP rate limit (graceful "too many attempts" message), timing-equalized `verify()` (`DUMMY_PASSWORD_HASH` for unknown users) with a single generic login error, duplicate-username guard, argon2id hashing, PAYER custodial-wallet provisioning in a transaction, session creation, and audit — then `redirect()` to the role dashboard (thrown outside try/catch so `NEXT_REDIRECT` propagates). `logoutAction` destroys the session and redirects to `/login`.
- Added the themed pages `src/app/(auth)/login/page.tsx` and `src/app/(auth)/signup/page.tsx` (client components on `useActionState`, primary pill CTA with pending state, `role="alert"` errors, signup role radio-cards via `has-[:checked]`), the `src/components/auth/FloatingInput.tsx` floating-label input (BRAND §7, visible focus ring), and `src/app/(auth)/logout/route.ts` (`GET /logout` → destroy session → redirect).
- Followed strict TDD for the pure helper: wrote `tests/lib/auth-redirect.test.ts` first (RED), then implemented to GREEN (1 test, all roles). Server Actions + pages are typechecked and build-verified (`pnpm build` ✓); full form flows are covered by Playwright e2e in Phase 9.

## 2026-06-29 — Fix #17: proxy middleware — authz matrix + security headers (TDD)

- Added `src/lib/route-roles.ts` (pure): `requiredRoleForPath` maps the `(payer)`/`(merchant)`/`(admin)` URL prefixes to `PAYER`/`MERCHANT`/`ADMIN` (everything else `public`); `evaluateAccess(pathname, role)` returns `allow` (public or matching role), `login` (anonymous on a protected route), or `forbidden` (wrong role).
- Added `src/lib/security-headers.ts` (pure): `buildCsp()` a strict CSP (scripts `'self'` only; `style-src`/`font-src` allowlist Google Fonts + Material Symbols; `img-src` allows `data:`/`blob:`/`https:` for QR + signed URLs; `frame-ancestors 'none'`, `object-src 'none'`). `applySecurityHeaders(res, pathname)` adds CSP + HSTS + `nosniff` + `Referrer-Policy` + `X-Frame-Options: DENY` + a `Permissions-Policy` that grants `camera=(self)` only on `/payer/scan` and denies it elsewhere.
- Added `src/proxy.ts` (Next 16 Node-runtime middleware): reads the session cookie → `lookupSession` → `evaluateAccess`; redirects to `/login?next=…`, returns `403`, or continues — and applies the security headers to **every** response. `config.matcher` excludes Next internals/static assets. The proxy is a coarse first gate; handlers still re-check via `requireRole` (default-deny).
- Followed strict TDD: wrote the two helper test files first (RED), then implemented to GREEN. 8 tests (route-roles 5, security-headers 3) cover the role matrix, all four access decisions, the full hardening header set, and the scan-only camera grant. The middleware itself is composed from these tested helpers and verified end-to-end in Phase 9.

## 2026-06-29 — Fix #15: login route with rate limiting + account lockout (TDD)

- Added `src/app/api/auth/login/route.ts`: `POST /api/auth/login {username, password}`. Same-origin guard, per-IP rate limit (20/15min), Zod validation. Looks up the user and **always** runs a password `verify()` — against `DUMMY_PASSWORD_HASH` for unknown users — to equalize timing and prevent account enumeration. Returns a single generic `401 "Invalid username or password"` for both wrong-password and unknown-user. Tracks per-username failures in Redis; after `MAX_FAILS=5` it sets a 15-minute lockout (subsequent attempts get `429`, even with the correct password). On success: clears the failure counter, opens a session cookie, writes an `auth.login` audit entry; failures write `auth.login.failed`.
- Followed strict TDD: wrote `tests/api/auth/login.test.ts` first (RED), then implemented to GREEN against the live Postgres (redis mocked). 3 tests cover successful login + cookie, identical generic 401 for wrong-password vs unknown-user, and the lockout (429 on the 6th attempt).
- Deviation (test-only): redis `vi.mock` made hoisting-safe (construct the fake in the factory, retrieve via the mocked import).

## 2026-06-29 — Fix #16: session / logout / password routes (TDD)

- Added `src/app/api/auth/session/route.ts`: `GET /api/auth/session` → `{ user | null }` from the current session.
- Added `src/app/api/auth/logout/route.ts`: `POST /api/auth/logout` → same-origin guard, revokes the session row + clears the cookie (`destroySession`), writes an `auth.logout` audit when a user was present, returns `204`.
- Added `src/app/api/auth/password/route.ts`: `POST /api/auth/password {currentPassword, newPassword}` → re-auth required (`requireUser`), per-user rate limit (5/15min), verifies the current password (401 on mismatch), hashes the new one, **revokes all sessions and issues a fresh one for this device** (privilege-change rotation), audits `auth.password.change`, returns `204`.
- Followed strict TDD: wrote `tests/api/auth/session-logout-password.test.ts` first (RED), then implemented to GREEN against the live Postgres (redis mocked). 5 tests cover session null/loaded, logout 204 + revoke + cookie clear, wrong-current-password 401, successful change (new hash verifies, sessions rotated to exactly one), and password-change requiring auth (401 logged out).
- Deviation (test-only): redis `vi.mock` made hoisting-safe.

## 2026-06-29 — Fix #14: signup route + client-IP helper (TDD, integration)

- Added `src/lib/net.ts`: `clientIp(req)` — first `X-Forwarded-For` hop, else `X-Real-IP`, else `"unknown"`.
- Added `src/app/api/auth/signup/route.ts`: `POST /api/auth/signup {username, password, role}`. Enforces same-origin (CSRF), rate-limits per IP (5/hour), validates input with Zod (`username` 3–32 `[a-zA-Z0-9_.]`, `password` 8–200, `role ∈ {PAYER, MERCHANT}`), rejects duplicate usernames with 409, hashes the password (argon2id), and creates the user + (for PAYER) a `CustodialWallet` via `walletService.generate()` in a single transaction. Then opens a session cookie and writes an `auth.signup` audit entry; returns `201 {user}`.
- Followed strict TDD: wrote `tests/api/auth/signup.test.ts` first (RED), then implemented to GREEN against the live Postgres (redis + `walletService` mocked). 5 tests cover MERCHANT signup (no wallet) + session cookie, PAYER signup provisioning a custodial wallet, duplicate-username 409, invalid-role 400, and short-password 400.
- Deviation (test-only): reworked the redis `vi.mock` to be hoisting-safe (construct the fake inside the hoisted factory, retrieve via the mocked import) — the plan's factory referenced a top-level variable Vitest cannot access.

## 2026-06-29 — Fix #21: custodial Stellar WalletService (TDD)

- Added `src/server/stellar/wallet.ts`: the locked `WalletService` over an injectable `Horizon.Server` (`createWalletService(server?, passphrase?)` resolves Horizon/passphrase lazily so importing never hits the network; `walletService` is the env-wired singleton). `generate()` builds a random keypair and returns the public key + envelope-encrypted secret + key version. `getBalance()` reads the native balance (0 on a 404/unfunded account). `sendXlm()` decrypts the secret in-memory only, builds a native payment with a text memo, fetches the base fee, sets a 180s timeout, signs, and submits — amount formatted to 7dp via `formatXlm`. `confirmTx()` polls the tx until it appears in the ledger (success/failure definitive; bounded retries). `listIncomingPayments()` pages native payments addressed to the account and advances the cursor past every scanned record. `import "server-only"` module.
- Followed strict TDD: wrote `tests/server/stellar/wallet.test.ts` first (RED), then implemented to GREEN with a chainable fake Horizon server. 7 tests cover key generation (valid G-key + decryptable S-seed), native-balance parsing, the unfunded-404 → 0 case, the built/signed/submitted payment (memo, native asset, 7dp amount, timebounds), confirm true/false, and incoming-payment filtering + cursor advance. Added a `describe.skipIf` testnet+friendbot integration test (`wallet.integration.test.ts`) that only runs with `RUN_STELLAR_IT=1` so `pnpm vitest run` stays offline-safe.

## 2026-06-29 — Fix #20: Horizon singleton (TDD)

- Added `src/server/stellar/horizon.ts`: `getHorizon()` lazily constructs a cached `Horizon.Server` from `STELLAR_HORIZON_URL` (allowing HTTP only for `http://` URLs), throwing if the URL is unset. `getNetworkPassphrase()` returns an explicit `STELLAR_NETWORK_PASSPHRASE` override when present, else `Networks.PUBLIC` for mainnet / `Networks.TESTNET` otherwise. `__resetHorizonForTests()` drops the cache. `import "server-only"` module.
- Installed `@stellar/stellar-sdk` (16.x) and `sodium-native` (fast ed25519 signing, auto-detected by stellar-base) — the Stellar foundation for the wallet service.
- Followed strict TDD: wrote `tests/server/stellar/horizon.test.ts` first (RED), then implemented to GREEN. 5 tests cover singleton caching, the testnet/mainnet passphrase selection, the explicit override, and the missing-URL guard.

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
