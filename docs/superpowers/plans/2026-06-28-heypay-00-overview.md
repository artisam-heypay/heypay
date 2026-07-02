# HeyPay Implementation Plan — Master Overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> This is the **master overview**. It defines the goal, architecture, global constraints, the file-structure map, the locked shared contracts every phase depends on, and the phase index with dependency ordering. Each phase has its own detailed plan file (`2026-06-28-heypay-NN-*.md`) containing bite-sized TDD tasks. **Execute phases in order; within a phase, execute tasks in order.**

**Goal:** Build HeyPay end-to-end: a responsive Next.js web app letting a Payer pay any QRPH merchant in the Philippines from a custodial Stellar (XLM) balance, converting XLM→PHP via PDAX and settling PHP to the merchant's bank, with payer/merchant/admin surfaces, an async settlement worker, and a mock rail so the full happy path runs locally and in CI.

**Architecture:** A single Next.js 16 App Router app provides UI (Server/Client Components) and backend (Route Handlers + Server Actions). PostgreSQL via Prisma 7 (driver adapter) is the database; Redis + BullMQ back the asynchronous settlement pipeline run by a separate `worker` process; S3-compatible object storage (MinIO dev / Railway prod) holds uploads. External rails (Stellar Horizon, PDAX REST) are reached server-side only, PDAX behind a `PaymentRailProvider` interface with `Pdax` and `Mock` implementations. A `Payment` advances through an idempotent, resumable state machine driven by the worker.

**Tech Stack:** Next.js 16.2.x (App Router, Turbopack, `proxy.ts` middleware) · React 19.2.x · TypeScript strict · pnpm · Prisma 7 (`provider = "prisma-client"`, `@prisma/adapter-pg` + `pg`) · PostgreSQL 17 · Redis 7 + BullMQ + ioredis · Tailwind CSS v4 (CSS-first `@theme`) · `@stellar/stellar-sdk` v15.x + `sodium-native` · PDAX REST (HMAC) · Zod · argon2 · jose · `@aws-sdk/client-s3` + presigner · decimal.js · jsqr/@zxing/library + qrcode · Vitest + Playwright · ESLint (flat) + Prettier.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from `SPEC.md` / `AGENT.md` / `BRAND.md`.

- **Latest stable deps.** Install with `pnpm add <pkg>@latest`; adopt newest stable major and adapt to breaking changes. `pnpm audit --prod` must be clean; lockfile committed; `packageManager` pinned. No `postinstall` from untrusted packages.
- **Node.js 22 LTS.** Next 16 requires Node ≥ 20.9.
- **TypeScript `strict: true`.** No `any` at boundaries. Zod parses every Route Handler / Server Action input; export inferred types. Co-locate Zod schemas with handlers.
- **Money is `Decimal` only — never `number`/float.** Prisma `Decimal`; `decimal.js` in code. XLM = 7 decimal places; PHP = 2. Round half-up at display only; never accumulate float error. All amounts in code are `Decimal`; format only at the view layer.
- **Stellar amounts** are strings with ≤7 decimals; always set timebounds and fetch base fee; confirm tx success by polling tx result (submit ≠ success).
- **Secrets never reach client/logs/git/browser.** Mark secret modules `import "server-only"`. Custodial Stellar secrets and merchant bank account numbers are envelope-encrypted at rest (AES-256-GCM, `ENCRYPTION_MASTER_KEY` + `secretKeyVersion`). `.env.example` holds placeholders only. Never log secrets, full account numbers, session tokens, or wallet secrets.
- **Idempotency on every money-moving POST** via `Idempotency-Key` header + `IdempotencyKey` table; worker jobs keyed by `paymentId:status`; all external side effects retry-safe and resumable.
- **Consistent error envelope:** `{ "error": { "code": string, "message": string, "details"?: unknown } }`. Never leak stack traces, SQL, or provider internals. Proper HTTP status codes.
- **Cursor-based pagination** for all lists.
- **AuthZ default-deny.** Enforced in `proxy.ts` (route group → required role) **and** re-checked in every handler/action (ownership checks on every payment/merchant/wallet read+write). Admin overrides are audited.
- **External calls** wrapped with timeout + retry (exponential backoff + jitter) + circuit breaker; validate all responses (untrusted).
- **Provider abstraction** (`PaymentRailProvider`) and `WalletService` interfaces stay stable so USDC/USDT and alternative rails slot in without touching the state machine.
- **Feature-flag** USDC/USDT (`PaymentAsset` modeled, only XLM enabled) and any `PENDING_REVIEW` admin gate.
- **Theming:** encode every BRAND.md token into the Tailwind v4 `@theme` block; reference tokens (`bg-primary`, `text-mono-data`, `p-stack-lg`) — never hard-code hex/px. Cyan = trust/confirmed, orange (`secondary`) = live/pending/processing. Pills for consumer payment CTAs, `rounded-lg` for data/admin surfaces. Show XLM + PHP together (XLM primary, PHP human reference). All on-chain/financial numerics use `mono-data`. Respect `prefers-reduced-motion`. WCAG AA contrast; tap targets ≥ 44×44px; status conveyed by text/badge, not color alone.
- **Default dev config:** `PAYMENT_RAIL=mock`, `STELLAR_NETWORK=testnet` — full happy path runs without real money or PDAX prod credentials.
- **Migrations:** every schema change is a checked-in migration; never edit an applied migration; `prisma migrate deploy` on release; never `db push` in prod; always set `SHADOW_DATABASE_URL`.
- **Commits:** Conventional Commits, small focused changes. Naming: `camelCase` vars, `PascalCase` types/components, `SCREAMING_SNAKE` env. Document any deviation from `SPEC.md` in the commit/PR body.

---

## File Structure Map

```
heypay/
├─ prisma/
│  ├─ schema.prisma              # full data model (SPEC §4)
│  ├─ migrations/                # checked-in migrations
│  └─ seed.ts                    # idempotent admin + optional demo seed
├─ prisma.config.ts              # Prisma 7 config (schema path, seed command)
├─ src/
│  ├─ app/
│  │  ├─ (auth)/login, signup, logout
│  │  ├─ (payer)/payer/{dashboard,scan,pay/[paymentId]/confirm,prefund,transactions,settings}
│  │  ├─ (merchant)/merchant/{onboarding,dashboard,transactions,qr,settings}
│  │  ├─ (admin)/admin/{page,users,merchants,payments,health}
│  │  ├─ api/                    # Route Handlers (SPEC §6)
│  │  ├─ layout.tsx              # root layout, fonts, providers
│  │  └─ globals.css             # Tailwind v4 @theme (BRAND.md §9)
│  ├─ proxy.ts                   # Next 16 middleware (authz + security headers + CSP)
│  ├─ server/
│  │  ├─ auth/                   # sessions.ts, password.ts, csrf.ts, rate-limit.ts, audit.ts
│  │  ├─ db.ts                   # Prisma singleton (+ @prisma/adapter-pg)
│  │  ├─ redis.ts                # ioredis singleton
│  │  ├─ crypto/                 # envelope.ts (AES-256-GCM)
│  │  ├─ stellar/                # wallet.ts (gen/encrypt/sign/submit/poll), horizon.ts
│  │  ├─ rails/                  # provider.ts (interface+types), pdax.ts, mock.ts, index.ts
│  │  ├─ qrph/                   # tlv.ts (parser), crc.ts (CRC-16), decode.ts, resolve.ts
│  │  ├─ payments/              # quote.ts, confirm.ts, state-machine.ts, reference.ts
│  │  ├─ storage/                # s3.ts (client + presign + magic-byte verify)
│  │  └─ queue/                  # queues.ts, jobs/{settle.ts,deposit-poller.ts,reconcile.ts}
│  ├─ worker/                    # index.ts (worker entrypoint, consumes queues)
│  ├─ lib/                       # money.ts, errors.ts, http.ts, validation.ts, retry.ts, format.ts
│  └─ components/                # themed UI: ui/* primitives + feature components
├─ tests/                        # vitest unit/integration + playwright e2e
├─ docker-compose.yml            # postgres + redis + minio (dev)
├─ .env.example
├─ Dockerfile                    # multi-stage (web); worker reuses image
├─ railway.json                  # web + worker services config
├─ playwright.config.ts
├─ vitest.config.ts
├─ eslint.config.mjs
└─ package.json
```

---

## Locked Shared Contracts

**Every phase plan MUST consume these signatures verbatim.** If a phase needs a new shared type, it adds it here in its plan's "Interfaces > Produces" block first, then uses it. Do not rename or re-shape these.

### Money (`src/lib/money.ts`)

```typescript
import { Decimal } from "decimal.js";
export { Decimal };

// Construct from any source; throws on NaN/Infinity.
export function dec(value: string | number | Decimal): Decimal;
// Format XLM with exactly 7 dp (string), half-up. e.g. "12.5000000"
export function formatXlm(value: Decimal): string;
// Format PHP with exactly 2 dp (string), half-up. e.g. "1234.50"
export function formatPhp(value: Decimal): string;
// Display helper: "₱1,234.50" (grouped, 2dp).
export function displayPhp(value: Decimal): string;
// Display helper: "12.5000000 XLM" (7dp).
export function displayXlm(value: Decimal): string;
// Quote math: given phpAmount and rate (1 XLM = rate PHP) -> XLM needed (7dp, ROUND_UP so payer covers).
export function phpToXlm(phpAmount: Decimal, rate: Decimal): Decimal;
// availableXlm = cachedXlmBalance - reservedXlm
export function availableXlm(cached: Decimal, reserved: Decimal): Decimal;
```

### Errors (`src/lib/errors.ts`)

```typescript
export type ErrorEnvelope = { error: { code: string; message: string; details?: unknown } };

// Thrown inside handlers; caught by the API wrapper and rendered as ErrorEnvelope.
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  );
}
// Convenience constructors (all return AppError):
export const badRequest:   (msg: string, details?: unknown) => AppError; // 400
export const unauthorized: (msg?: string) => AppError;                    // 401
export const forbidden:    (msg?: string) => AppError;                    // 403
export const notFound:     (msg?: string) => AppError;                    // 404
export const conflict:     (msg: string, details?: unknown) => AppError;  // 409
export const tooManyRequests: (msg?: string) => AppError;                 // 429
export const serverError:  (msg?: string) => AppError;                    // 500
```

### HTTP wrapper (`src/lib/http.ts`)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export type Handler = (req: NextRequest, ctx: HandlerContext) => Promise<NextResponse>;
export type HandlerContext = {
  params: Record<string, string>;
  userId: string | null;
  role: Role | null;
};

// Wraps a handler: catches AppError/ZodError -> ErrorEnvelope + status; logs full detail server-side.
export function route(
  handler: Handler,
): (req: NextRequest, raw: { params: Promise<Record<string, string>> }) => Promise<NextResponse>;
// JSON success helper.
export function json<T>(data: T, status?: number): NextResponse;
// Parse + validate JSON body with a Zod schema; throws badRequest on failure.
export function parseBody<S extends z.ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>>;
// Parse + validate query params.
export function parseQuery<S extends z.ZodTypeAny>(req: NextRequest, schema: S): z.infer<S>;
```

### Auth / sessions (`src/server/auth/sessions.ts`)

```typescript
import { Role } from "@/generated/prisma";
export type SessionUser = { id: string; username: string; role: Role; isActive: boolean };

// Reads & validates the session cookie; returns the user or null. For use in handlers/RSC/actions.
export function getSessionUser(): Promise<SessionUser | null>;
// Returns the user or throws unauthorized().
export function requireUser(): Promise<SessionUser>;
// Returns the user or throws forbidden() if role mismatch.
export function requireRole(role: Role): Promise<SessionUser>;
// Creates a session row (token hashed) and sets the HttpOnly cookie. Returns raw token (for tests only).
export function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string },
): Promise<void>;
// Revokes current session and clears cookie.
export function destroySession(): Promise<void>;
```

### CSRF (`src/server/auth/csrf.ts`)

```typescript
// Verifies Origin/Sec-Fetch-Site for unsafe methods; throws forbidden() on mismatch. Call in route() for non-GET.
export function assertSameOrigin(req: Request): void;
```

### Rate limiting (`src/server/auth/rate-limit.ts`)

```typescript
// Redis token bucket. Throws tooManyRequests() when exceeded. key e.g. `login:ip:1.2.3.4`.
export function rateLimit(key: string, opts: { limit: number; windowSec: number }): Promise<void>;
```

### Audit (`src/server/auth/audit.ts`)

```typescript
// Writes an AuditLog row. Never throws into the request path (best-effort).
export function audit(input: {
  actorId?: string | null;
  action: string;
  target?: string;
  metadata?: unknown;
  ip?: string;
}): Promise<void>;
```

### Crypto (`src/server/crypto/envelope.ts`)

```typescript
// AES-256-GCM envelope encryption using ENCRYPTION_MASTER_KEY. Returns a self-describing string
// "v<version>:<base64 iv>:<base64 tag>:<base64 ciphertext>".
export function encryptSecret(plaintext: string): string;
// Decrypts a string produced by encryptSecret; verifies auth tag; selects key by version prefix.
export function decryptSecret(payload: string): string;
```

### Stellar wallet service (`src/server/stellar/wallet.ts`)

```typescript
import { Decimal } from "@/lib/money";
export interface WalletService {
  // Generate a keypair; returns public key + encrypted secret (caller persists).
  generate(): { publicKey: string; encryptedSecret: string; secretKeyVersion: number };
  // Fetch live XLM balance from Horizon (0 if account not yet funded/created).
  getBalance(publicKey: string): Promise<Decimal>;
  // Build/sign/submit a payment of amountXlm from the custodial account to `destination` with `memo`.
  // Sets timebounds + base fee. Returns the tx hash. Decrypts secret only in-memory here.
  sendXlm(input: {
    encryptedSecret: string;
    destination: string;
    amountXlm: Decimal;
    memo: string;
  }): Promise<{ txHash: string }>;
  // Poll Horizon for tx success; resolves true on success, false on definitive failure.
  confirmTx(txHash: string): Promise<boolean>;
  // List incoming payments after `cursor` for prefund detection. Returns items + new cursor.
  listIncomingPayments(
    publicKey: string,
    cursor?: string,
  ): Promise<{ items: IncomingPayment[]; cursor?: string }>;
}
export type IncomingPayment = {
  id: string;
  amountXlm: Decimal;
  from: string;
  txHash: string;
  createdAt: Date;
};
export const walletService: WalletService;
```

### QRPH (`src/server/qrph/decode.ts`, `resolve.ts`)

```typescript
export type QrphDecoded = {
  raw: string;
  payloadFormat: string; // tag 00
  pointOfInit: "static" | "dynamic"; // tag 01: 11=static, 12=dynamic
  merchantName?: string; // tag 59
  merchantCity?: string; // tag 60
  merchantId?: string; // from merchant account info template
  acquirerId?: string;
  country: string; // tag 58 (default PH)
  currency: string; // tag 53 (608 = PHP)
  amountPhp?: string; // tag 54 (present for dynamic QR)
  crcValid: boolean;
};
// Parse raw EMVCo TLV string and validate CRC-16/CCITT-FALSE. Throws badRequest if structure/CRC invalid.
export function decodeQrph(raw: string): QrphDecoded;
// Decode a QR image buffer to its raw string (jsqr/zxing), then decodeQrph.
export function decodeQrphImage(image: Buffer): Promise<QrphDecoded>;

// resolve.ts
import { Merchant } from "@/generated/prisma";
// Resolve decoded QRPH to a registered ACTIVE merchant or null.
export function resolveMerchant(decoded: QrphDecoded): Promise<Merchant | null>;
```

### Payment rail provider (`src/server/rails/provider.ts`)

```typescript
import { Decimal } from "@/lib/money";
export type Quote = { rate: Decimal; phpAmount: Decimal; xlmAmount: Decimal; expiresAt: Date };
export type TradeResult = { tradeRef: string };
export type TradeStatus = {
  state: "PENDING" | "FILLED" | "FAILED";
  feePhp?: Decimal;
  filledPhp?: Decimal;
};
export type BankPayout = { bankCode: string; accountName: string; accountNumber: string };
export type PayoutResult = { payoutRef: string };
export type PayoutStatus = { state: "PENDING" | "SETTLED" | "FAILED"; netPhp?: Decimal };

export interface PaymentRailProvider {
  getQuote(input: { sell: "XLM"; buy: "PHP"; phpAmount: Decimal }): Promise<Quote>;
  sellCryptoForPhp(input: { ref: string; xlmAmount: Decimal }): Promise<TradeResult>;
  getTradeStatus(tradeRef: string): Promise<TradeStatus>;
  cashOutPhpToBank(input: {
    ref: string;
    phpAmount: Decimal;
    bank: BankPayout;
  }): Promise<PayoutResult>;
  getPayoutStatus(payoutRef: string): Promise<PayoutStatus>;
}
// src/server/rails/index.ts — selects implementation by PAYMENT_RAIL env (mock | pdax).
export const rail: PaymentRailProvider;
```

### Storage (`src/server/storage/s3.ts`)

```typescript
export type PresignResult = { url: string; fields: Record<string, string>; key: string };
// Presigned POST for an upload of given content type; enforces size limit server-side in the policy.
export function presignUpload(input: {
  prefix: "qrph" | "logo";
  contentType: string;
  maxBytes: number;
}): Promise<PresignResult>;
// Verify an uploaded object's magic bytes + size match an allowed image type; throws badRequest if not.
export function verifyUploadedObject(key: string): Promise<void>;
// Return a time-limited signed GET URL for an object key.
export function signedGetUrl(key: string): Promise<string>;
```

### Queue (`src/server/queue/queues.ts`)

```typescript
export const QUEUE_NAMES = {
  settle: "settle",
  depositPoll: "deposit-poll",
  reconcile: "reconcile",
} as const;
// Enqueue a settlement step. jobId = `${paymentId}:${status}` for idempotency.
export function enqueueSettle(paymentId: string): Promise<void>;
```

### Payment reference (`src/server/payments/reference.ts`)

```typescript
// Generate a human-facing unique reference: "TXN-" + 8 uppercase base32 chars.
export function newPaymentReference(): string;
```

---

## Settlement State Machine (authoritative)

```
CREATED → QUOTED → AUTHORIZED → STELLAR_SUBMITTED → STELLAR_CONFIRMED
        → PDAX_TRADING → PDAX_TRADED → PAYOUT_SUBMITTED → SETTLED   [terminal success]
Any step → FAILED (failureReason)                                   [terminal]
If XLM left wallet but PHP not settled → REFUND_PENDING → REFUNDED  [terminal]
```

Each transition: persisted (`PaymentEvent`), idempotent (worker job keyed `paymentId:status`), retried with exponential backoff + jitter. Worker is resumable per current status.

---

## Phase Index & Dependency Order

Execute top to bottom. Each phase file is a self-contained plan that produces working, testable software.

| Phase                 | File                                      | Depends on | Deliverable                                                                                                                                                                                                         |
| --------------------- | ----------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Foundation & Infra | `2026-06-28-heypay-01-foundation.md`      | —          | Next.js 16 app boots; Tailwind v4 theme; docker-compose; Prisma schema + migration + seed; `lib/money.ts`, `lib/errors.ts`, `lib/http.ts`, db/redis singletons. Unit tests for money/errors green.                  |
| 2. Auth & Sessions    | `2026-06-28-heypay-02-auth.md`            | 1          | argon2id passwords, server sessions, signup/login/logout/session/password endpoints, `proxy.ts` (authz + security headers + CSP), CSRF, Redis rate limiting, audit log. Integration tests green.                    |
| 3. Core Services      | `2026-06-28-heypay-03-services.md`        | 1          | Envelope crypto, Stellar wallet service (testnet), QRPH TLV+CRC parser + image decode + merchant resolution, S3/MinIO storage (presign + magic-byte verify). Unit tests (CRC vectors, encryption round-trip) green. |
| 4. Payment Rail       | `2026-06-28-heypay-04-rail.md`            | 1, 3       | `PaymentRailProvider` interface, `MockProvider` (deterministic + forced-failure switch), `PdaxProvider` (HMAC signing, TOTP for crypto-out). Unit tests green; mock drives full flow.                               |
| 5. Payments & Worker  | `2026-06-28-heypay-05-payments-worker.md` | 1–4        | Quote/confirm domain + idempotency, payment API handlers, BullMQ queues, worker settlement state machine, deposit poller, reconciliation. Integration + state-machine unit tests green.                             |
| 6. Payer UI           | `2026-06-28-heypay-06-payer-ui.md`        | 1–5        | Dashboard, scan, confirm/pay (processing overlay), prefund, transactions, settings — themed per BRAND.                                                                                                              |
| 7. Merchant UI        | `2026-06-28-heypay-07-merchant-ui.md`     | 1–5        | Onboarding wizard (live preview), dashboard, transactions (CSV), business QR, settings + merchant API.                                                                                                              |
| 8. Admin UI           | `2026-06-28-heypay-08-admin-ui.md`        | 1–5        | Overview, users, merchants, payments (timeline + retry/refund), health + admin API.                                                                                                                                 |
| 9. Testing & Deploy   | `2026-06-28-heypay-09-testing-deploy.md`  | 1–8        | Playwright e2e happy paths, Dockerfile, railway.json, `.env.example` finalization, quality gates (typecheck/lint/audit), webhook handler, reconciliation cron.                                                      |

---

## Self-Review Coverage Map (spec → phase)

- SPEC §1 product/happy path → 5, 6, 7. §2 personas/roles → 2 (roles), 6/7/8 (surfaces).
- §3 architecture/state machine → 1 (app/db/redis), 5 (state machine), 9 (worker service/deploy).
- §4 data model + seed → 1. §5 pages/routes → 6, 7, 8 (+ `proxy.ts` in 2).
- §6 API endpoints → 2 (auth), 5 (wallet/qrph/payments), 7 (merchant), 8 (admin), 9 (uploads presign, webhooks).
- §7 integrations: Stellar → 3; PDAX → 4; QRPH → 3; Railway → 9.
- §8 core flows → 5 (prefund poller, settlement), 6 (pay flow UI), 7 (onboarding).
- §9 money/correctness → 1 (money), 5 (quote/idempotency/reconcile).
- §10 non-functional → cross-cutting; observability/resilience in 5, testing/a11y in 9 + each UI phase.
- §11 env → 1 (`.env.example` skeleton), 9 (finalize). §12 deliverables → all. AGENT §5/§6 security → 2, 3, 9. BRAND → 1 (tokens) + 6/7/8 (usage).
