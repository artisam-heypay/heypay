# Phase 5: Payments & Settlement Worker — HeyPay

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute tasks in order; within a task, execute steps in order.
>
> This phase builds the **Payments domain** (reference, idempotency, quote, confirm, state machine), the **BullMQ queues + worker process** that drives the idempotent/resumable settlement state machine, the **deposit poller** and **reconciliation** jobs, and the **wallet / qrph / payments Route Handlers**. It is the engine behind SPEC §8.1 (prefund) and §8.2 (pay a merchant). All external side effects are retry-safe and resumable; the `MockProvider` (Phase 4) drives the full happy path locally and in CI.

**Goal:** Implement the asynchronous XLM→PHP settlement pipeline — quote/confirm domain, a persisted+idempotent `Payment` state machine, a BullMQ worker (settle/deposit-poll/reconcile), and the wallet/qrph/payments API — so a payer can quote, confirm, and have a payment settle end-to-end through the rail.

**Depends on: Phases 1–4** (money/errors/http/db/redis singletons; auth/sessions/csrf/rate-limit/audit; envelope crypto + Stellar `walletService` + QRPH decode/resolve + S3 storage; `PaymentRailProvider` + `rail` selector with `MockProvider`).

**Deliverable:** `src/server/payments/{reference,idempotency,quote,confirm,state-machine}.ts`, `src/lib/retry.ts`, `src/server/queue/{queues,jobs/settle,jobs/deposit-poller,jobs/reconcile}.ts`, `src/worker/index.ts`, and the wallet/qrph/payments Route Handlers — with state-machine unit tests, worker settlement tests (happy / FAILED / REFUND branches), and quote→confirm→poll integration tests all green under `pnpm vitest run`.

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from `SPEC.md` / `AGENT.md` / the master overview.

- **Money is `Decimal` only — never `number`/float.** Prisma `Decimal`; `decimal.js` in code. XLM = 7 dp; PHP = 2 dp. Round half-up at display only. Persist Prisma `Decimal` columns via fixed-precision strings (`.toFixed(7)` / `.toFixed(8)` / `.toFixed(2)`). Convert Prisma `Decimal` reads back through `dec(x.toString())` before doing math.
- **Idempotency on every money-moving POST** via `Idempotency-Key` header + `IdempotencyKey` table; worker jobs keyed by `paymentId:status`; all external side effects retry-safe and resumable.
- **External calls** wrapped with timeout + retry (exponential backoff + jitter); validate all responses (untrusted). Stellar/PDAX confirmation is by polling (submit ≠ success).
- **Secrets never reach client/logs/git.** Mark secret-touching modules `import "server-only"` (payments domain, queue, worker). Decrypt merchant bank account / wallet secret only in-memory at the point of use; never log them or full account numbers.
- **AuthZ default-deny.** Every handler re-checks the session (`requireUser`/`requireRole`) and **ownership** (payer owns the payment/wallet) independent of `proxy.ts`. `assertSameOrigin(req)` on every non-GET handler. `rateLimit` on `quote` and `confirm`.
- **Consistent error envelope** `{ "error": { "code", "message", "details"? } }` via `AppError`; proper status codes. Never leak stack traces / SQL / provider internals.
- **Cursor-based pagination** for all lists (`/api/wallet/transactions`).
- **Consume the Locked Shared Contracts verbatim** (`money`, `errors`, `http`, `sessions`, `csrf`, `rate-limit`, `audit`, `envelope`, `walletService`, `rail`, `storage`, `QUEUE_NAMES`/`enqueueSettle`, `newPaymentReference`). Do not rename or re-shape them.
- **Default dev/test config:** `PAYMENT_RAIL=mock`, `STELLAR_NETWORK=testnet`. The full happy path runs without real money.
- **Commits:** Conventional Commits, small focused changes. `camelCase` vars, `PascalCase` types, `SCREAMING_SNAKE` env.

### Test prerequisites (apply to every DB-touching task)

DB-touching tests run against a throwaway Postgres (the docker-compose `postgres`). Before running them once per machine/CI: `docker compose up -d postgres redis` then `pnpm prisma migrate deploy`. Vitest loads `.env` (test `DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_MASTER_KEY`, `PAYMENT_RAIL=mock`). Unit tests that `vi.mock` `@/server/rails`, `@/server/stellar/wallet`, and `@/server/queue/queues` do not hit those externals.

---

## Task 1: Payment reference generator

**Files:**

- Create: `src/server/payments/reference.ts`
- Test: `src/server/payments/reference.test.ts`

**Interfaces:**

- Consumes: nothing (Node `crypto`).
- Produces (LOCKED — overview "Payment reference"):

  ```typescript
  // Generate a human-facing unique reference: "TXN-" + 8 uppercase base32 chars.
  export function newPaymentReference(): string;
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// src/server/payments/reference.test.ts
import { describe, it, expect } from "vitest";
import { newPaymentReference } from "./reference";

describe("newPaymentReference", () => {
  it("matches TXN- + 8 RFC4648 base32 uppercase chars", () => {
    expect(newPaymentReference()).toMatch(/^TXN-[A-Z2-7]{8}$/);
  });

  it("is (practically) unique across 5000 calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(newPaymentReference());
    expect(seen.size).toBe(5000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/payments/reference.test.ts`
Expected: FAIL — `Cannot find module './reference'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/server/payments/reference.ts
import "server-only";
import { randomBytes } from "node:crypto";

// RFC 4648 base32 alphabet (no padding), uppercase.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newPaymentReference(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % 32];
  return `TXN-${out}`;
}
```

> Note: `server-only` makes this module import-safe to use in tests via the same path; vitest resolves it as a no-op. If your vitest config does not stub `server-only`, add `vi.mock("server-only", () => ({}))` to the test setup file once (Phase 1 setup) — do not remove the import.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/server/payments/reference.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/payments/reference.ts src/server/payments/reference.test.ts
git commit -m "feat(payments): add newPaymentReference TXN base32 generator" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Idempotency helper

**Files:**

- Create: `src/server/payments/idempotency.ts`
- Create: `tests/helpers/db.ts` (shared DB reset + factories, reused by later tasks)
- Test: `src/server/payments/idempotency.test.ts`

**Interfaces:**

- Consumes: `db` (`@/server/db`), `conflict`, `badRequest` (`@/lib/errors`), `Prisma` (`@/generated/prisma`).
- Produces:

  ```typescript
  // Runs fn once per (scope,key); stores the JSON result; replays return the stored result.
  // Concurrent in-flight call for the same key throws conflict(). Missing key throws badRequest().
  export function withIdempotencyKey<T>(
    key: string | null | undefined,
    scope: string,
    fn: () => Promise<T>,
    opts?: { ttlSec?: number },
  ): Promise<T>;
  ```

  ```typescript
  // tests/helpers/db.ts
  export function resetDb(): Promise<void>;
  export function makePayer(opts?: {
    cachedXlm?: string;
    reservedXlm?: string;
  }): Promise<{ user: User; wallet: CustodialWallet }>;
  export function makeMerchant(opts?: {
    status?: MerchantStatus;
    accountNumber?: string;
  }): Promise<{ user: User; merchant: Merchant }>;
  ```

- [ ] **Step 1: Write the shared test DB helper**

```typescript
// tests/helpers/db.ts
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { encryptSecret } from "@/server/crypto/envelope";
import type { User, CustodialWallet, Merchant, MerchantStatus } from "@/generated/prisma";

export async function resetDb(): Promise<void> {
  // Order respects FK constraints (children first).
  await db.paymentEvent.deleteMany();
  await db.walletTransaction.deleteMany();
  await db.payment.deleteMany();
  await db.idempotencyKey.deleteMany();
  await db.exchangeRateSnapshot.deleteMany();
  await db.auditLog.deleteMany();
  await db.merchant.deleteMany();
  await db.custodialWallet.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
}

export async function makePayer(opts?: {
  cachedXlm?: string;
  reservedXlm?: string;
}): Promise<{ user: User; wallet: CustodialWallet }> {
  const user = await db.user.create({
    data: { username: `payer-${randomUUID()}`, passwordHash: "x", role: "PAYER" },
  });
  const wallet = await db.custodialWallet.create({
    data: {
      userId: user.id,
      stellarPublicKey: `G${randomUUID().replace(/-/g, "").toUpperCase()}`,
      encryptedSecret: encryptSecret(`S${randomUUID().replace(/-/g, "").toUpperCase()}`),
      cachedXlmBalance: opts?.cachedXlm ?? "1000.0000000",
      reservedXlm: opts?.reservedXlm ?? "0.0000000",
    },
  });
  return { user, wallet };
}

export async function makeMerchant(opts?: {
  status?: MerchantStatus;
  accountNumber?: string;
}): Promise<{ user: User; merchant: Merchant }> {
  const user = await db.user.create({
    data: { username: `merchant-${randomUUID()}`, passwordHash: "x", role: "MERCHANT" },
  });
  const acct = opts?.accountNumber ?? "1234567890";
  const merchant = await db.merchant.create({
    data: {
      userId: user.id,
      businessName: "Test Store",
      status: opts?.status ?? "ACTIVE",
      qrphRaw: "QRPHRAW",
      qrphMerchantId: "MID123",
      settlementBankCode: "BPI",
      settlementBankName: "Bank of the Philippine Islands",
      accountName: "Test Store Inc",
      accountNumber: encryptSecret(acct),
      accountNumberLast4: acct.slice(-4),
    },
  });
  return { user, merchant };
}
```

- [ ] **Step 2: Write the failing test**

```typescript
// src/server/payments/idempotency.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { resetDb } from "../../../tests/helpers/db";
import { withIdempotencyKey } from "./idempotency";
import { AppError } from "@/lib/errors";

describe("withIdempotencyKey", () => {
  beforeEach(resetDb);

  it("runs fn once and replays the cached response", async () => {
    const key = randomUUID();
    const fn = vi.fn().mockResolvedValue({ ok: true, n: 1 });
    const a = await withIdempotencyKey(key, "test.scope", fn);
    const b = await withIdempotencyKey(key, "test.scope", fn);
    expect(a).toEqual({ ok: true, n: 1 });
    expect(b).toEqual({ ok: true, n: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("scopes keys: same key under a different scope runs again", async () => {
    const key = randomUUID();
    const fn = vi.fn().mockResolvedValue({ v: 1 });
    await withIdempotencyKey(key, "scope.a", fn);
    await withIdempotencyKey(key, "scope.b", fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rejects a concurrent in-flight call for the same key with conflict (409)", async () => {
    const key = randomUUID();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = withIdempotencyKey(key, "test.scope", async () => {
      await gate;
      return { done: true };
    });
    await expect(
      withIdempotencyKey(key, "test.scope", async () => ({ done: false })),
    ).rejects.toMatchObject({ status: 409 });
    release();
    await expect(slow).resolves.toEqual({ done: true });
  });

  it("throws badRequest (400) when the key is missing", async () => {
    await expect(withIdempotencyKey("", "test.scope", async () => 1)).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(withIdempotencyKey(undefined, "test.scope", async () => 1)).rejects.toMatchObject({
      status: 400,
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/server/payments/idempotency.test.ts`
Expected: FAIL — `Cannot find module './idempotency'`.

- [ ] **Step 4: Write minimal implementation**

```typescript
// src/server/payments/idempotency.ts
import "server-only";
import { Prisma } from "@/generated/prisma";
import { db } from "@/server/db";
import { badRequest, conflict } from "@/lib/errors";

const DEFAULT_TTL_SEC = 60 * 60 * 24; // 24h

export async function withIdempotencyKey<T>(
  key: string | null | undefined,
  scope: string,
  fn: () => Promise<T>,
  opts?: { ttlSec?: number },
): Promise<T> {
  if (!key) throw badRequest("Idempotency-Key is required");
  const storedKey = `${scope}:${key}`;
  const expiresAt = new Date(Date.now() + (opts?.ttlSec ?? DEFAULT_TTL_SEC) * 1000);

  // Atomically claim the key. A unique-constraint violation means it already exists.
  try {
    await db.idempotencyKey.create({ data: { key: storedKey, scope, expiresAt } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await db.idempotencyKey.findUnique({ where: { key: storedKey } });
      if (existing?.response != null) return existing.response as T;
      // Row exists but no response yet → another call is in flight.
      throw conflict("A request with this Idempotency-Key is already in progress");
    }
    throw err;
  }

  const result = await fn();
  await db.idempotencyKey.update({
    where: { key: storedKey },
    data: { response: result as unknown as Prisma.InputJsonValue },
  });
  return result;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/server/payments/idempotency.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/payments/idempotency.ts src/server/payments/idempotency.test.ts tests/helpers/db.ts
git commit -m "feat(payments): add withIdempotencyKey helper + test DB factories" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Settlement state machine

**Files:**

- Create: `src/server/payments/state-machine.ts`
- Test: `src/server/payments/state-machine.test.ts`

**Interfaces:**

- Consumes: `db`, `conflict` (`@/lib/errors`), `PaymentStatus`, `Payment`, `Prisma` (`@/generated/prisma`).
- Produces:

  ```typescript
  import { PaymentStatus, Payment, Prisma } from "@/generated/prisma";
  export type TxClient = Prisma.TransactionClient;

  // Legal transition table (authoritative — matches overview "Settlement State Machine").
  export const TRANSITIONS: Record<PaymentStatus, PaymentStatus[]>;
  export const TERMINAL: ReadonlySet<PaymentStatus>; // SETTLED, FAILED, REFUNDED
  export const XLM_MOVED: ReadonlySet<PaymentStatus>; // states where XLM has left the wallet
  export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean;
  export function isTerminal(status: PaymentStatus): boolean;
  // Happy-path next status for the worker to drive, or null if terminal / manual-only.
  export function nextStep(status: PaymentStatus): PaymentStatus | null;
  // Validate + persist a transition: update Payment.status and write a PaymentEvent. Throws conflict on illegal edge.
  export function applyTransition(
    client: TxClient,
    payment: { id: string; status: PaymentStatus },
    toStatus: PaymentStatus,
    detail?: Prisma.InputJsonValue,
  ): Promise<Payment>;
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// src/server/payments/state-machine.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { newPaymentReference } from "./reference";
import {
  TRANSITIONS,
  TERMINAL,
  XLM_MOVED,
  canTransition,
  isTerminal,
  nextStep,
  applyTransition,
} from "./state-machine";

describe("state machine (pure)", () => {
  it("encodes the authoritative happy path", () => {
    expect(nextStep("CREATED")).toBe("QUOTED");
    expect(nextStep("QUOTED")).toBe("AUTHORIZED");
    expect(nextStep("AUTHORIZED")).toBe("STELLAR_SUBMITTED");
    expect(nextStep("STELLAR_SUBMITTED")).toBe("STELLAR_CONFIRMED");
    expect(nextStep("STELLAR_CONFIRMED")).toBe("PDAX_TRADING");
    expect(nextStep("PDAX_TRADING")).toBe("PDAX_TRADED");
    expect(nextStep("PDAX_TRADED")).toBe("PAYOUT_SUBMITTED");
    expect(nextStep("PAYOUT_SUBMITTED")).toBe("SETTLED");
    expect(nextStep("REFUND_PENDING")).toBe("REFUNDED");
    expect(nextStep("SETTLED")).toBeNull();
  });

  it("allows legal transitions and rejects illegal ones", () => {
    expect(canTransition("QUOTED", "AUTHORIZED")).toBe(true);
    expect(canTransition("AUTHORIZED", "STELLAR_SUBMITTED")).toBe(true);
    expect(canTransition("QUOTED", "SETTLED")).toBe(false);
    expect(canTransition("CREATED", "AUTHORIZED")).toBe(false);
    expect(canTransition("SETTLED", "REFUNDED")).toBe(false);
  });

  it("permits the refund branch only once XLM has moved", () => {
    // XLM moved → refund allowed
    expect(XLM_MOVED.has("STELLAR_CONFIRMED")).toBe(true);
    expect(canTransition("STELLAR_CONFIRMED", "REFUND_PENDING")).toBe(true);
    expect(canTransition("PDAX_TRADED", "REFUND_PENDING")).toBe(true);
    expect(canTransition("PAYOUT_SUBMITTED", "REFUND_PENDING")).toBe(true);
    expect(canTransition("REFUND_PENDING", "REFUNDED")).toBe(true);
    // Before XLM moves, failures go to FAILED, not REFUND_PENDING.
    expect(canTransition("AUTHORIZED", "REFUND_PENDING")).toBe(false);
    expect(canTransition("AUTHORIZED", "FAILED")).toBe(true);
  });

  it("marks terminal states", () => {
    expect([...TERMINAL].sort()).toEqual(["FAILED", "REFUNDED", "SETTLED"]);
    expect(isTerminal("SETTLED")).toBe(true);
    expect(isTerminal("PDAX_TRADING")).toBe(false);
  });

  it("every status appears as a key in TRANSITIONS", () => {
    for (const s of Object.values({ ...require("@/generated/prisma").PaymentStatus } as Record<
      string,
      string
    >)) {
      expect(TRANSITIONS).toHaveProperty(s);
    }
  });
});

describe("applyTransition (persisted)", () => {
  beforeEach(resetDb);

  async function makeQuoted() {
    const { user } = await makePayer();
    const { merchant } = await makeMerchant();
    return db.payment.create({
      data: {
        reference: newPaymentReference(),
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: "100.00",
        quotedRate: "12.00000000",
        amountXlm: "8.3333334",
        networkFeeXlm: "0.0000100",
        status: "QUOTED",
        quoteExpiresAt: new Date(Date.now() + 90_000),
      },
    });
  }

  it("persists a legal transition and writes a PaymentEvent", async () => {
    const p = await makeQuoted();
    const updated = await applyTransition(db, p, "AUTHORIZED", { reservedXlm: "8.3333434" });
    expect(updated.status).toBe("AUTHORIZED");
    const events = await db.paymentEvent.findMany({ where: { paymentId: p.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: "QUOTED", toStatus: "AUTHORIZED" });
  });

  it("throws conflict (409) on an illegal transition and writes no event", async () => {
    const p = await makeQuoted();
    await expect(applyTransition(db, p, "SETTLED")).rejects.toMatchObject({ status: 409 });
    expect(await db.paymentEvent.count({ where: { paymentId: p.id } })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/payments/state-machine.test.ts`
Expected: FAIL — `Cannot find module './state-machine'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/server/payments/state-machine.ts
import "server-only";
import { PaymentStatus, type Payment, type Prisma } from "@/generated/prisma";
import { db } from "@/server/db";
import { conflict } from "@/lib/errors";

export type TxClient = Prisma.TransactionClient;

const S = PaymentStatus;

export const TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [S.CREATED]: [S.QUOTED, S.FAILED],
  [S.QUOTED]: [S.AUTHORIZED, S.FAILED],
  [S.AUTHORIZED]: [S.STELLAR_SUBMITTED, S.FAILED],
  // submitted-but-unconfirmed: confirm step decides CONFIRMED vs FAILED (tx never landed)
  [S.STELLAR_SUBMITTED]: [S.STELLAR_CONFIRMED, S.FAILED],
  // from here on XLM has left the wallet → failures branch to REFUND_PENDING
  [S.STELLAR_CONFIRMED]: [S.PDAX_TRADING, S.REFUND_PENDING],
  [S.PDAX_TRADING]: [S.PDAX_TRADED, S.REFUND_PENDING],
  [S.PDAX_TRADED]: [S.PAYOUT_SUBMITTED, S.REFUND_PENDING],
  [S.PAYOUT_SUBMITTED]: [S.SETTLED, S.REFUND_PENDING],
  [S.REFUND_PENDING]: [S.REFUNDED, S.FAILED],
  [S.SETTLED]: [],
  [S.FAILED]: [],
  [S.REFUNDED]: [],
};

export const TERMINAL: ReadonlySet<PaymentStatus> = new Set([S.SETTLED, S.FAILED, S.REFUNDED]);
export const XLM_MOVED: ReadonlySet<PaymentStatus> = new Set([
  S.STELLAR_CONFIRMED,
  S.PDAX_TRADING,
  S.PDAX_TRADED,
  S.PAYOUT_SUBMITTED,
]);

const NEXT: Partial<Record<PaymentStatus, PaymentStatus>> = {
  [S.CREATED]: S.QUOTED,
  [S.QUOTED]: S.AUTHORIZED,
  [S.AUTHORIZED]: S.STELLAR_SUBMITTED,
  [S.STELLAR_SUBMITTED]: S.STELLAR_CONFIRMED,
  [S.STELLAR_CONFIRMED]: S.PDAX_TRADING,
  [S.PDAX_TRADING]: S.PDAX_TRADED,
  [S.PDAX_TRADED]: S.PAYOUT_SUBMITTED,
  [S.PAYOUT_SUBMITTED]: S.SETTLED,
  [S.REFUND_PENDING]: S.REFUNDED,
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminal(status: PaymentStatus): boolean {
  return TERMINAL.has(status);
}

export function nextStep(status: PaymentStatus): PaymentStatus | null {
  return NEXT[status] ?? null;
}

export async function applyTransition(
  client: TxClient,
  payment: { id: string; status: PaymentStatus },
  toStatus: PaymentStatus,
  detail?: Prisma.InputJsonValue,
): Promise<Payment> {
  if (!canTransition(payment.status, toStatus)) {
    throw conflict(`illegal transition ${payment.status} -> ${toStatus}`);
  }
  const updated = await client.payment.update({
    where: { id: payment.id },
    data: { status: toStatus },
  });
  await client.paymentEvent.create({
    data: {
      paymentId: payment.id,
      fromStatus: payment.status,
      toStatus,
      detail: detail ?? undefined,
    },
  });
  return updated;
}

void db; // db is the default non-tx client callers may pass as TxClient (structurally compatible)
```

> Note: `applyTransition` accepts any client matching `Prisma.TransactionClient`. The full `PrismaClient` (`db`) is structurally assignable, so callers pass `db` outside a transaction and `tx` inside `db.$transaction(...)`. Remove the `void db;` line if your linter flags it and instead omit the import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/server/payments/state-machine.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/payments/state-machine.ts src/server/payments/state-machine.test.ts
git commit -m "feat(payments): add settlement state machine (transitions, nextStep, applyTransition)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Quote domain (`createQuote`)

**Files:**

- Create: `src/server/payments/quote.ts`
- Test: `src/server/payments/quote.test.ts`

**Interfaces:**

- Consumes: `rail` (`@/server/rails`), `dec`, `phpToXlm`, `availableXlm`, `Decimal` (`@/lib/money`), `newPaymentReference` (Task 1), `withRetry` (Task 6 — but quote ships before the worker; **create `src/lib/retry.ts` here if not present**, see note), `db`, `notFound`/`conflict` (`@/lib/errors`).
- Produces:
  ```typescript
  import { Decimal } from "@/lib/money";
  export const STELLAR_BASE_FEE_XLM: Decimal; // 100 stroops = 0.0000100 XLM (1 payment op)
  export type CreateQuoteInput = { payerId: string; merchantId: string; amountPhp: Decimal };
  export type CreateQuoteResult = {
    paymentId: string;
    reference: string;
    amountPhp: Decimal;
    rate: Decimal;
    amountXlm: Decimal;
    networkFeeXlm: Decimal;
    quoteExpiresAt: Date;
  };
  export function createQuote(input: CreateQuoteInput): Promise<CreateQuoteResult>;
  ```

> **Ordering note:** `createQuote` calls `withRetry` from `src/lib/retry.ts`. That file is formally created in Task 6. If you execute strictly in order, add a minimal `src/lib/retry.ts` exporting `withRetry` (copy the implementation from Task 6 Step 3) as the first step of this task, and let Task 6 add `pollUntil` alongside it. The signature is identical, so no rework is needed.

- [ ] **Step 1: Write the failing test**

```typescript
// src/server/payments/quote.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";

vi.mock("@/server/rails", () => ({
  rail: {
    getQuote: vi.fn(async ({ phpAmount }: { phpAmount: import("@/lib/money").Decimal }) => ({
      rate: dec("12"),
      phpAmount,
      xlmAmount: phpAmount.div(12),
      expiresAt: new Date(Date.now() + 90_000),
    })),
  },
}));

import { createQuote } from "./quote";

describe("createQuote", () => {
  beforeEach(resetDb);

  it("computes amountXlm (ROUND_UP) + base fee and persists a QUOTED Payment + rate snapshot", async () => {
    const { user } = await makePayer({ cachedXlm: "100.0000000" });
    const { merchant } = await makeMerchant();
    const res = await createQuote({
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: dec("100"),
    });

    expect(res.rate.toString()).toBe("12");
    // 100 / 12 = 8.3333333... → ROUND_UP at 7dp = 8.3333334
    expect(res.amountXlm.toFixed(7)).toBe("8.3333334");
    expect(res.networkFeeXlm.toFixed(7)).toBe("0.0000100");
    expect(res.reference).toMatch(/^TXN-[A-Z2-7]{8}$/);

    const payment = await db.payment.findUniqueOrThrow({ where: { id: res.paymentId } });
    expect(payment.status).toBe("QUOTED");
    expect(payment.quotedRate.toString()).toBe("12");
    expect(await db.exchangeRateSnapshot.count()).toBe(1);
    const events = await db.paymentEvent.findMany({ where: { paymentId: res.paymentId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: "CREATED", toStatus: "QUOTED" });
  });

  it("rejects insufficient available funds with conflict (409)", async () => {
    const { user } = await makePayer({ cachedXlm: "5.0000000" }); // needs ~8.33 XLM
    const { merchant } = await makeMerchant();
    await expect(
      createQuote({ payerId: user.id, merchantId: merchant.id, amountPhp: dec("100") }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.payment.count()).toBe(0);
  });

  it("rejects a non-ACTIVE merchant with notFound (404)", async () => {
    const { user } = await makePayer();
    const { merchant } = await makeMerchant({ status: "DRAFT" });
    await expect(
      createQuote({ payerId: user.id, merchantId: merchant.id, amountPhp: dec("100") }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/payments/quote.test.ts`
Expected: FAIL — `Cannot find module './quote'` (or `'@/lib/retry'`).

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/server/payments/quote.ts
import "server-only";
import { dec, phpToXlm, availableXlm, Decimal } from "@/lib/money";
import { db } from "@/server/db";
import { rail } from "@/server/rails";
import { withRetry } from "@/lib/retry";
import { conflict, notFound } from "@/lib/errors";
import { newPaymentReference } from "./reference";

// One Stellar payment operation costs the base fee of 100 stroops = 0.0000100 XLM.
export const STELLAR_BASE_FEE_XLM: Decimal = dec("0.0000100");

export type CreateQuoteInput = { payerId: string; merchantId: string; amountPhp: Decimal };
export type CreateQuoteResult = {
  paymentId: string;
  reference: string;
  amountPhp: Decimal;
  rate: Decimal;
  amountXlm: Decimal;
  networkFeeXlm: Decimal;
  quoteExpiresAt: Date;
};

export async function createQuote(input: CreateQuoteInput): Promise<CreateQuoteResult> {
  const merchant = await db.merchant.findUnique({ where: { id: input.merchantId } });
  if (!merchant || merchant.status !== "ACTIVE")
    throw notFound("merchant not available for payment");

  const wallet = await db.custodialWallet.findUnique({ where: { userId: input.payerId } });
  if (!wallet) throw conflict("payer wallet not found");

  const quote = await withRetry(
    () => rail.getQuote({ sell: "XLM", buy: "PHP", phpAmount: input.amountPhp }),
    {
      label: "rail.getQuote",
    },
  );
  const rate = quote.rate;
  const amountXlm = phpToXlm(input.amountPhp, rate); // ROUND_UP, 7dp (payer covers)
  const networkFeeXlm = STELLAR_BASE_FEE_XLM;
  const requiredXlm = amountXlm.plus(networkFeeXlm);

  const available = availableXlm(
    dec(wallet.cachedXlmBalance.toString()),
    dec(wallet.reservedXlm.toString()),
  );
  if (available.lessThan(requiredXlm)) {
    throw conflict("insufficient available XLM balance", {
      availableXlm: available.toFixed(7),
      requiredXlm: requiredXlm.toFixed(7),
    });
  }

  const payment = await db.$transaction(async (tx) => {
    await tx.exchangeRateSnapshot.create({
      data: { pair: "XLMPHP", rate: rate.toFixed(8), source: "PDAX" },
    });
    const p = await tx.payment.create({
      data: {
        reference: newPaymentReference(),
        payerId: input.payerId,
        merchantId: input.merchantId,
        asset: "XLM",
        amountPhp: input.amountPhp.toFixed(2),
        quotedRate: rate.toFixed(8),
        amountXlm: amountXlm.toFixed(7),
        networkFeeXlm: networkFeeXlm.toFixed(7),
        status: "QUOTED",
        quoteExpiresAt: quote.expiresAt,
      },
    });
    await tx.paymentEvent.create({
      data: {
        paymentId: p.id,
        fromStatus: "CREATED",
        toStatus: "QUOTED",
        detail: { rate: rate.toFixed(8) },
      },
    });
    return p;
  });

  return {
    paymentId: payment.id,
    reference: payment.reference,
    amountPhp: input.amountPhp,
    rate,
    amountXlm,
    networkFeeXlm,
    quoteExpiresAt: quote.expiresAt,
  };
}
```

> Reference-collision safety: `Payment.reference` is `@unique`. A `P2002` on `reference` is astronomically unlikely (8×5 random bits) but if you want belt-and-suspenders, wrap the `tx.payment.create` in a 3-try retry that regenerates `newPaymentReference()` on `P2002`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/server/payments/quote.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/payments/quote.ts src/server/payments/quote.test.ts src/lib/retry.ts
git commit -m "feat(payments): add createQuote (rate lock, fee, funds check, QUOTED payment)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Confirm domain (`confirmPayment`)

**Files:**

- Create: `src/server/payments/confirm.ts`
- Test: `src/server/payments/confirm.test.ts`

**Interfaces:**

- Consumes: `withIdempotencyKey` (Task 2), `applyTransition` (Task 3), `enqueueSettle` (`@/server/queue/queues`, Task 6 — **mock it in this task's test**), `dec`, `availableXlm` (`@/lib/money`), `db`, `notFound`/`forbidden`/`conflict` (`@/lib/errors`).
- Produces:

  ```typescript
  import { PaymentStatus } from "@/generated/prisma";
  export type ConfirmPaymentInput = { paymentId: string; payerId: string; idemKey: string };
  export type ConfirmPaymentResult = { paymentId: string; status: PaymentStatus };
  export function confirmPayment(input: ConfirmPaymentInput): Promise<ConfirmPaymentResult>;
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// src/server/payments/confirm.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { resetDb, makePayer, makeMerchant } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { newPaymentReference } from "./reference";

const enqueueSettle = vi.fn(async () => {});
vi.mock("@/server/queue/queues", () => ({
  QUEUE_NAMES: { settle: "settle", depositPoll: "deposit-poll", reconcile: "reconcile" },
  enqueueSettle: (id: string) => enqueueSettle(id),
}));

import { confirmPayment } from "./confirm";

async function makeQuoted(opts?: { cachedXlm?: string; expiresInMs?: number }) {
  const { user, wallet } = await makePayer({ cachedXlm: opts?.cachedXlm ?? "100.0000000" });
  const { merchant } = await makeMerchant();
  const payment = await db.payment.create({
    data: {
      reference: newPaymentReference(),
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: "100.00",
      quotedRate: "12.00000000",
      amountXlm: "8.3333334",
      networkFeeXlm: "0.0000100",
      status: "QUOTED",
      quoteExpiresAt: new Date(Date.now() + (opts?.expiresInMs ?? 90_000)),
    },
  });
  return { user, wallet, payment };
}

describe("confirmPayment", () => {
  beforeEach(async () => {
    await resetDb();
    enqueueSettle.mockClear();
  });

  it("reserves funds, sets AUTHORIZED, enqueues settlement", async () => {
    const { user, wallet, payment } = await makeQuoted();
    const res = await confirmPayment({
      paymentId: payment.id,
      payerId: user.id,
      idemKey: randomUUID(),
    });
    expect(res).toEqual({ paymentId: payment.id, status: "AUTHORIZED" });

    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("8.3333434"); // 8.3333334 + 0.0000100
    expect(
      await db.paymentEvent.count({ where: { paymentId: payment.id, toStatus: "AUTHORIZED" } }),
    ).toBe(1);
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
  });

  it("rejects an expired quote with conflict (409) and reserves nothing", async () => {
    const { user, wallet, payment } = await makeQuoted({ expiresInMs: -1000 });
    await expect(
      confirmPayment({ paymentId: payment.id, payerId: user.id, idemKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000");
    expect(enqueueSettle).not.toHaveBeenCalled();
  });

  it("is idempotent on double-confirm with the same Idempotency-Key (reserves once)", async () => {
    const { user, wallet, payment } = await makeQuoted();
    const key = randomUUID();
    const a = await confirmPayment({ paymentId: payment.id, payerId: user.id, idemKey: key });
    const b = await confirmPayment({ paymentId: payment.id, payerId: user.id, idemKey: key });
    expect(a).toEqual(b);
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("8.3333434"); // reserved exactly once
    expect(enqueueSettle).toHaveBeenCalledTimes(1);
  });

  it("rejects confirming another user's payment with forbidden (403)", async () => {
    const { payment } = await makeQuoted();
    const { user: stranger } = await makePayer();
    await expect(
      confirmPayment({ paymentId: payment.id, payerId: stranger.id, idemKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/payments/confirm.test.ts`
Expected: FAIL — `Cannot find module './confirm'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/server/payments/confirm.ts
import "server-only";
import { PaymentStatus } from "@/generated/prisma";
import { db } from "@/server/db";
import { dec, availableXlm } from "@/lib/money";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { withIdempotencyKey } from "./idempotency";
import { applyTransition } from "./state-machine";
import { enqueueSettle } from "@/server/queue/queues";

export type ConfirmPaymentInput = { paymentId: string; payerId: string; idemKey: string };
export type ConfirmPaymentResult = { paymentId: string; status: PaymentStatus };

export async function confirmPayment(input: ConfirmPaymentInput): Promise<ConfirmPaymentResult> {
  return withIdempotencyKey(input.idemKey, "payment.confirm", async () => {
    const payment = await db.payment.findUnique({
      where: { id: input.paymentId },
      include: { payer: { include: { wallet: true } } },
    });
    if (!payment) throw notFound("payment not found");
    if (payment.payerId !== input.payerId) throw forbidden("not your payment");

    // Already authorised (e.g. a retried request with a fresh key) → return current state.
    if (payment.status === "AUTHORIZED") return { paymentId: payment.id, status: payment.status };
    if (payment.status !== "QUOTED")
      throw conflict(`cannot confirm payment in status ${payment.status}`);
    if (!payment.quoteExpiresAt || payment.quoteExpiresAt.getTime() < Date.now()) {
      throw conflict("quote expired; please re-quote");
    }

    const wallet = payment.payer.wallet;
    if (!wallet) throw conflict("payer wallet not found");
    const total = dec(payment.amountXlm.toString()).plus(payment.networkFeeXlm.toString());

    const updated = await db.$transaction(async (tx) => {
      const w = await tx.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const available = availableXlm(
        dec(w.cachedXlmBalance.toString()),
        dec(w.reservedXlm.toString()),
      );
      if (available.lessThan(total)) throw conflict("insufficient available XLM balance");
      await tx.custodialWallet.update({
        where: { id: w.id },
        data: { reservedXlm: dec(w.reservedXlm.toString()).plus(total).toFixed(7) },
      });
      return applyTransition(tx, payment, "AUTHORIZED", { reservedXlm: total.toFixed(7) });
    });

    await enqueueSettle(payment.id);
    return { paymentId: updated.id, status: updated.status };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/server/payments/confirm.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/payments/confirm.ts src/server/payments/confirm.test.ts
git commit -m "feat(payments): add confirmPayment (reserve funds, AUTHORIZED, enqueue settle)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Retry/poll utilities + BullMQ queues + `enqueueSettle`

**Files:**

- Create/extend: `src/lib/retry.ts` (created in Task 4; add `pollUntil` + finalize `withRetry` here)
- Create: `src/server/queue/queues.ts`
- Test: `src/lib/retry.test.ts`
- Test: `src/server/queue/queues.test.ts`

**Interfaces:**

- Consumes: `db` (`@/server/db`), `REDIS_URL` env, `bullmq` `Queue`, `ioredis`.
- Produces:

  ```typescript
  // src/lib/retry.ts
  export type RetryOpts = { retries?: number; baseMs?: number; maxMs?: number; label?: string };
  // Exponential backoff + full jitter. Retries on any thrown error up to `retries` (default 4).
  export function withRetry<T>(fn: () => Promise<T>, opts?: RetryOpts): Promise<T>;
  export type PollOpts = { attempts?: number; intervalMs?: number; label?: string };
  // Calls fn until done(value) is true; throws after `attempts`. Returns the last value when done.
  export function pollUntil<T>(
    fn: () => Promise<T>,
    done: (v: T) => boolean,
    opts?: PollOpts,
  ): Promise<T>;

  // src/server/queue/queues.ts  (LOCKED contract)
  export const QUEUE_NAMES: {
    readonly settle: "settle";
    readonly depositPoll: "deposit-poll";
    readonly reconcile: "reconcile";
  };
  export const settleQueue: import("bullmq").Queue;
  export const depositPollQueue: import("bullmq").Queue;
  export const reconcileQueue: import("bullmq").Queue;
  export const bullConnection: import("ioredis").Redis; // shared connection for Queues + Workers
  // Enqueue the next settlement step. jobId = `${paymentId}:${currentStatus}` for idempotency.
  export function enqueueSettle(paymentId: string): Promise<void>;
  ```

- [ ] **Step 1: Write the failing retry test**

```typescript
// src/lib/retry.test.ts
import { describe, it, expect, vi } from "vitest";
import { withRetry, pollUntil } from "./retry";

describe("withRetry", () => {
  it("returns on first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue(42);
    expect(await withRetry(fn)).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue("ok");
    expect(await withRetry(fn, { retries: 4, baseMs: 1, maxMs: 4 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always"));
    await expect(withRetry(fn, { retries: 2, baseMs: 1, maxMs: 2 })).rejects.toThrow("always");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

describe("pollUntil", () => {
  it("resolves when the predicate is satisfied", async () => {
    let n = 0;
    const v = await pollUntil(
      async () => ++n,
      (x) => x >= 3,
      { attempts: 5, intervalMs: 1 },
    );
    expect(v).toBe(3);
  });

  it("throws when not done within attempts", async () => {
    await expect(
      pollUntil(
        async () => 0,
        (x) => x === 1,
        { attempts: 3, intervalMs: 1, label: "trade" },
      ),
    ).rejects.toThrow(/trade/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/retry.test.ts`
Expected: FAIL — `pollUntil` is not exported (or module missing if Task 4 stub absent).

- [ ] **Step 3: Write the retry/poll implementation**

```typescript
// src/lib/retry.ts
export type RetryOpts = { retries?: number; baseMs?: number; maxMs?: number; label?: string };
export type PollOpts = { attempts?: number; intervalMs?: number; label?: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseMs = opts.baseMs ?? 200;
  const maxMs = opts.maxMs ?? 5_000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      const backoff = Math.min(maxMs, baseMs * 2 ** attempt);
      const jitter = Math.random() * backoff; // full jitter
      await sleep(jitter);
    }
  }
  throw lastErr;
}

export async function pollUntil<T>(
  fn: () => Promise<T>,
  done: (v: T) => boolean,
  opts: PollOpts = {},
): Promise<T> {
  const attempts = opts.attempts ?? 30;
  const intervalMs = opts.intervalMs ?? 1_000;
  let value!: T;
  for (let i = 0; i < attempts; i++) {
    value = await fn();
    if (done(value)) return value;
    if (i < attempts - 1) await sleep(intervalMs);
  }
  throw new Error(
    `pollUntil timed out${opts.label ? ` (${opts.label})` : ""} after ${attempts} attempts`,
  );
}
```

- [ ] **Step 4: Run retry tests to verify they pass**

Run: `pnpm vitest run src/lib/retry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing queues test**

```typescript
// src/server/queue/queues.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { newPaymentReference } from "@/server/payments/reference";

const add = vi.fn(async () => {});
vi.mock("bullmq", () => ({
  Queue: vi
    .fn()
    .mockImplementation((name: string) => ({ name, add, close: vi.fn(async () => {}) })),
  Worker: vi.fn(),
}));
vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({ quit: vi.fn(async () => {}) })),
}));

import { QUEUE_NAMES, enqueueSettle } from "./queues";

describe("queues", () => {
  beforeEach(async () => {
    await resetDb();
    add.mockClear();
  });

  it("exposes the locked QUEUE_NAMES", () => {
    expect(QUEUE_NAMES).toEqual({
      settle: "settle",
      depositPoll: "deposit-poll",
      reconcile: "reconcile",
    });
  });

  it("enqueueSettle uses jobId `${paymentId}:${status}` for idempotency", async () => {
    const { user } = await makePayer();
    const { merchant } = await makeMerchant();
    const p = await db.payment.create({
      data: {
        reference: newPaymentReference(),
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: "100.00",
        quotedRate: "12.00000000",
        amountXlm: "8.3333334",
        networkFeeXlm: "0.0000100",
        status: "AUTHORIZED",
      },
    });
    await enqueueSettle(p.id);
    expect(add).toHaveBeenCalledTimes(1);
    const [, , optsArg] = add.mock.calls[0];
    expect(optsArg.jobId).toBe(`${p.id}:AUTHORIZED`);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm vitest run src/server/queue/queues.test.ts`
Expected: FAIL — `Cannot find module './queues'`.

- [ ] **Step 7: Write the queues implementation**

```typescript
// src/server/queue/queues.ts
import "server-only";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { db } from "@/server/db";

export const QUEUE_NAMES = {
  settle: "settle",
  depositPoll: "deposit-poll",
  reconcile: "reconcile",
} as const;

// BullMQ requires maxRetriesPerRequest: null on the shared connection.
export const bullConnection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

const defaultJobOpts = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 2_000 },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
};

export const settleQueue = new Queue(QUEUE_NAMES.settle, {
  connection: bullConnection,
  defaultJobOptions: defaultJobOpts,
});
export const depositPollQueue = new Queue(QUEUE_NAMES.depositPoll, {
  connection: bullConnection,
  defaultJobOptions: defaultJobOpts,
});
export const reconcileQueue = new Queue(QUEUE_NAMES.reconcile, {
  connection: bullConnection,
  defaultJobOptions: defaultJobOpts,
});

export async function enqueueSettle(paymentId: string): Promise<void> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: { status: true },
  });
  if (!payment) return;
  // jobId ties the job to (payment, status); BullMQ dedupes a duplicate of the same step.
  await settleQueue.add("settle", { paymentId }, { jobId: `${paymentId}:${payment.status}` });
}
```

- [ ] **Step 8: Run queues tests to verify they pass**

Run: `pnpm vitest run src/server/queue/queues.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add src/lib/retry.ts src/lib/retry.test.ts src/server/queue/queues.ts src/server/queue/queues.test.ts
git commit -m "feat(queue): add withRetry/pollUntil + BullMQ queues and enqueueSettle" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Worker settlement processor (`jobs/settle.ts`)

**Files:**

- Create: `src/server/queue/jobs/settle.ts`
- Test: `src/server/queue/jobs/settle.test.ts`

**Interfaces:**

- Consumes: `db`, `rail` (`@/server/rails`), `walletService` (`@/server/stellar/wallet`), `applyTransition`/`nextStep`/`isTerminal`/`XLM_MOVED` (`@/server/payments/state-machine`), `enqueueSettle` (`@/server/queue/queues`), `withRetry`/`pollUntil` (`@/lib/retry`), `decryptSecret` (`@/server/crypto/envelope`), `audit` (`@/server/auth/audit`), `dec` (`@/lib/money`), `PaymentStatus`.
- Produces:
  ```typescript
  // Execute exactly ONE settlement step for the payment's current status, persist the transition,
  // and re-enqueue the next step. Resumable + idempotent per status. Never throws on terminal states.
  export function processSettleJob(job: { data: { paymentId: string } }): Promise<void>;
  ```
- Reads env `PDAX_XLM_DEPOSIT_ADDRESS` for the Stellar destination.

> **Design (matches SPEC §8.2.4 + overview state machine):** one job advances one edge, then re-enqueues. Each step guards against re-execution (checks for already-recorded side effects). External calls use `withRetry`; trade/payout settlement uses `pollUntil`. A step failure **before** XLM has moved → `FAILED` (+ release reservation). A step failure **after** XLM moved (`XLM_MOVED` set) → `REFUND_PENDING`, and the `REFUND_PENDING` step credits the payer (`REFUND_CREDIT`) → `REFUNDED` + admin alert. Exactly one `PAYMENT_DEBIT` and at most one `REFUND_CREDIT` per payment.

- [ ] **Step 1: Write the failing test (happy path + FAILED + REFUND branches)**

```typescript
// src/server/queue/jobs/settle.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { newPaymentReference } from "@/server/payments/reference";

// ---- mock externals ----
const sendXlm = vi.fn();
const confirmTx = vi.fn();
vi.mock("@/server/stellar/wallet", () => ({
  walletService: {
    sendXlm: (i: unknown) => sendXlm(i),
    confirmTx: (h: string) => confirmTx(h),
  },
}));

const sellCryptoForPhp = vi.fn();
const getTradeStatus = vi.fn();
const cashOutPhpToBank = vi.fn();
const getPayoutStatus = vi.fn();
vi.mock("@/server/rails", () => ({
  rail: {
    sellCryptoForPhp: (i: unknown) => sellCryptoForPhp(i),
    getTradeStatus: (r: string) => getTradeStatus(r),
    cashOutPhpToBank: (i: unknown) => cashOutPhpToBank(i),
    getPayoutStatus: (r: string) => getPayoutStatus(r),
  },
}));

// enqueueSettle is a no-op in tests; we drive steps manually.
vi.mock("@/server/queue/queues", () => ({
  QUEUE_NAMES: { settle: "settle", depositPoll: "deposit-poll", reconcile: "reconcile" },
  enqueueSettle: vi.fn(async () => {}),
}));

process.env.PDAX_XLM_DEPOSIT_ADDRESS = "GHEYPAYDEPOSITADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

import { processSettleJob } from "./settle";
import { isTerminal } from "@/server/payments/state-machine";

async function makeAuthorized() {
  // reservedXlm already includes amountXlm + fee, set at confirm time.
  const { user, wallet } = await makePayer({ cachedXlm: "100.0000000", reservedXlm: "8.3333434" });
  const { merchant } = await makeMerchant({ accountNumber: "9988776655" });
  const payment = await db.payment.create({
    data: {
      reference: newPaymentReference(),
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: "100.00",
      quotedRate: "12.00000000",
      amountXlm: "8.3333334",
      networkFeeXlm: "0.0000100",
      status: "AUTHORIZED",
    },
  });
  return { user, wallet, merchant, payment };
}

async function drive(paymentId: string) {
  for (let i = 0; i < 12; i++) {
    const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (isTerminal(p.status)) break;
    await processSettleJob({ data: { paymentId } });
  }
  return db.payment.findUniqueOrThrow({ where: { id: paymentId } });
}

describe("processSettleJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    return resetDb();
  });

  it("drives AUTHORIZED → SETTLED with exactly one PAYMENT_DEBIT", async () => {
    sendXlm.mockResolvedValue({ txHash: "STELLARHASH1" });
    confirmTx.mockResolvedValue(true);
    sellCryptoForPhp.mockResolvedValue({ tradeRef: "TRADE1" });
    getTradeStatus.mockResolvedValue({ state: "FILLED", feePhp: dec("2"), filledPhp: dec("100") });
    cashOutPhpToBank.mockResolvedValue({ payoutRef: "PAYOUT1" });
    getPayoutStatus.mockResolvedValue({ state: "SETTLED", netPhp: dec("98") });

    const { wallet, payment } = await makeAuthorized();
    const final = await drive(payment.id);

    expect(final.status).toBe("SETTLED");
    expect(final.stellarTxHash).toBe("STELLARHASH1");
    expect(final.pdaxTradeRef).toBe("TRADE1");
    expect(final.pdaxCashoutRef).toBe("PAYOUT1");
    expect(final.netSettledPhp?.toFixed(2)).toBe("98.00");
    expect(final.settledAt).not.toBeNull();
    // bank account decrypted to plaintext for the rail call
    expect(cashOutPhpToBank.mock.calls[0][0].bank.accountNumber).toBe("9988776655");

    const debits = await db.walletTransaction.findMany({
      where: { walletId: wallet.id, type: "PAYMENT_DEBIT" },
    });
    expect(debits).toHaveLength(1);
    expect(debits[0].amountXlm.toFixed(7)).toBe("-8.3333434");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000"); // reservation released
    expect(w.cachedXlmBalance.toFixed(7)).toBe("91.6666566"); // 100 - 8.3333434
  });

  it("forced Stellar-confirm failure → FAILED, reservation released, no debit (no double-debit)", async () => {
    sendXlm.mockResolvedValue({ txHash: "STELLARHASH2" });
    confirmTx.mockResolvedValue(false); // tx never landed → funds never left

    const { wallet, payment } = await makeAuthorized();
    const final = await drive(payment.id);

    expect(final.status).toBe("FAILED");
    expect(final.failureReason).toMatch(/stellar/i);
    expect(
      await db.walletTransaction.count({ where: { walletId: wallet.id, type: "PAYMENT_DEBIT" } }),
    ).toBe(0);
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000");
    expect(sellCryptoForPhp).not.toHaveBeenCalled();
  });

  it("forced post-Stellar (trade) failure → REFUND_PENDING → REFUNDED with one debit + one credit", async () => {
    sendXlm.mockResolvedValue({ txHash: "STELLARHASH3" });
    confirmTx.mockResolvedValue(true);
    sellCryptoForPhp.mockResolvedValue({ tradeRef: "TRADE3" });
    getTradeStatus.mockResolvedValue({ state: "FAILED" }); // trade rejected after XLM moved

    const { wallet, payment } = await makeAuthorized();
    const final = await drive(payment.id);

    expect(final.status).toBe("REFUNDED");
    const debits = await db.walletTransaction.findMany({
      where: { walletId: wallet.id, type: "PAYMENT_DEBIT" },
    });
    const credits = await db.walletTransaction.findMany({
      where: { walletId: wallet.id, type: "REFUND_CREDIT" },
    });
    expect(debits).toHaveLength(1);
    expect(credits).toHaveLength(1);
    expect(credits[0].amountXlm.toFixed(7)).toBe("8.3333434");
    // admin alerted
    expect(await db.auditLog.count({ where: { action: "payment.refunded" } })).toBe(1);
    // event trail includes REFUND_PENDING then REFUNDED
    const evs = await db.paymentEvent.findMany({
      where: { paymentId: payment.id },
      orderBy: { createdAt: "asc" },
    });
    const toStatuses = evs.map((e) => e.toStatus);
    expect(toStatuses).toContain("REFUND_PENDING");
    expect(toStatuses).toContain("REFUNDED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/queue/jobs/settle.test.ts`
Expected: FAIL — `Cannot find module './settle'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/server/queue/jobs/settle.ts
import "server-only";
import { PaymentStatus } from "@/generated/prisma";
import { db } from "@/server/db";
import { rail } from "@/server/rails";
import { walletService } from "@/server/stellar/wallet";
import { dec } from "@/lib/money";
import { withRetry, pollUntil } from "@/lib/retry";
import { decryptSecret } from "@/server/crypto/envelope";
import { audit } from "@/server/auth/audit";
import { enqueueSettle } from "@/server/queue/queues";
import {
  applyTransition,
  isTerminal,
  nextStep,
  XLM_MOVED,
  type TxClient,
} from "@/server/payments/state-machine";

type PaymentWithRels = Awaited<ReturnType<typeof loadPayment>>;

function loadPayment(id: string) {
  return db.payment.findUniqueOrThrow({
    where: { id },
    include: { merchant: true, payer: { include: { wallet: true } } },
  });
}

const TRADE_POLL = { attempts: 30, intervalMs: 1_000, label: "trade" };
const PAYOUT_POLL = { attempts: 30, intervalMs: 1_000, label: "payout" };

export async function processSettleJob(job: { data: { paymentId: string } }): Promise<void> {
  const payment = await loadPayment(job.data.paymentId);
  if (isTerminal(payment.status)) return;

  try {
    await dispatch(payment);
  } catch (err) {
    await handleFailure(payment, err);
    return; // terminal/refund path handled; do not rethrow
  }

  const fresh = await db.payment.findUniqueOrThrow({
    where: { id: payment.id },
    select: { status: true },
  });
  if (!isTerminal(fresh.status) && nextStep(fresh.status) !== null) {
    await enqueueSettle(payment.id);
  }
}

async function dispatch(p: PaymentWithRels): Promise<void> {
  switch (p.status) {
    case PaymentStatus.AUTHORIZED:
      return stepSubmitStellar(p);
    case PaymentStatus.STELLAR_SUBMITTED:
      return stepConfirmStellar(p);
    case PaymentStatus.STELLAR_CONFIRMED:
      return stepRequestTrade(p);
    case PaymentStatus.PDAX_TRADING:
      return stepPollTrade(p);
    case PaymentStatus.PDAX_TRADED:
      return stepRequestPayout(p);
    case PaymentStatus.PAYOUT_SUBMITTED:
      return stepPollPayout(p);
    case PaymentStatus.REFUND_PENDING:
      return stepRefund(p);
    default:
      return; // CREATED/QUOTED are driven synchronously by quote/confirm
  }
}

// AUTHORIZED → STELLAR_SUBMITTED
async function stepSubmitStellar(p: PaymentWithRels): Promise<void> {
  const wallet = p.payer.wallet!;
  const total = dec(p.amountXlm.toString()).plus(p.networkFeeXlm.toString());
  // Idempotency: if a tx was already submitted, just advance.
  let txHash = p.stellarTxHash;
  if (!txHash) {
    const res = await withRetry(
      () =>
        walletService.sendXlm({
          encryptedSecret: wallet.encryptedSecret,
          destination: process.env.PDAX_XLM_DEPOSIT_ADDRESS!,
          amountXlm: total,
          memo: p.reference,
        }),
      { label: "sendXlm" },
    );
    txHash = res.txHash;
    await db.payment.update({ where: { id: p.id }, data: { stellarTxHash: txHash } });
  }
  await applyTransition(db, p, PaymentStatus.STELLAR_SUBMITTED, { stellarTxHash: txHash });
}

// STELLAR_SUBMITTED → STELLAR_CONFIRMED (debit + release reservation) | FAILED (tx never landed)
async function stepConfirmStellar(p: PaymentWithRels): Promise<void> {
  const wallet = p.payer.wallet!;
  const total = dec(p.amountXlm.toString()).plus(p.networkFeeXlm.toString());
  const ok = await withRetry(() => walletService.confirmTx(p.stellarTxHash!), {
    label: "confirmTx",
  });

  if (!ok) {
    // Tx definitively failed → XLM never moved → release reservation, FAILED (no refund needed).
    await db.$transaction(async (tx) => {
      await releaseReservation(tx, wallet.id, total);
      await applyTransition(tx, p, PaymentStatus.FAILED, {
        failureReason: "stellar tx failed to confirm",
      });
      await tx.payment.update({
        where: { id: p.id },
        data: { failureReason: "stellar tx failed to confirm" },
      });
    });
    return;
  }

  await db.$transaction(async (tx) => {
    const w = await tx.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    // Idempotency: skip if a debit already exists for this payment.
    const existing = await tx.walletTransaction.findFirst({
      where: { paymentId: p.id, type: "PAYMENT_DEBIT" },
    });
    if (!existing) {
      const newBalance = dec(w.cachedXlmBalance.toString()).minus(total);
      await tx.walletTransaction.create({
        data: {
          walletId: w.id,
          type: "PAYMENT_DEBIT",
          amountXlm: total.negated().toFixed(7),
          balanceAfter: newBalance.toFixed(7),
          stellarTxHash: p.stellarTxHash,
          paymentId: p.id,
          memo: p.reference,
        },
      });
      await tx.custodialWallet.update({
        where: { id: w.id },
        data: {
          cachedXlmBalance: newBalance.toFixed(7),
          reservedXlm: dec(w.reservedXlm.toString()).minus(total).toFixed(7),
        },
      });
    }
    await applyTransition(tx, p, PaymentStatus.STELLAR_CONFIRMED, { debitedXlm: total.toFixed(7) });
  });
}

// STELLAR_CONFIRMED → PDAX_TRADING
async function stepRequestTrade(p: PaymentWithRels): Promise<void> {
  let tradeRef = p.pdaxTradeRef;
  if (!tradeRef) {
    const res = await withRetry(
      () => rail.sellCryptoForPhp({ ref: p.reference, xlmAmount: dec(p.amountXlm.toString()) }),
      { label: "sellCryptoForPhp" },
    );
    tradeRef = res.tradeRef;
    await db.payment.update({ where: { id: p.id }, data: { pdaxTradeRef: tradeRef } });
  }
  await applyTransition(db, p, PaymentStatus.PDAX_TRADING, { pdaxTradeRef: tradeRef });
}

// PDAX_TRADING → PDAX_TRADED (poll; FAILED state throws → refund)
async function stepPollTrade(p: PaymentWithRels): Promise<void> {
  const status = await pollUntil(
    () => rail.getTradeStatus(p.pdaxTradeRef!),
    (s) => s.state !== "PENDING",
    TRADE_POLL,
  );
  if (status.state !== "FILLED") throw new Error(`PDAX trade ${p.pdaxTradeRef} failed`);
  const feePhp = status.feePhp ? dec(status.feePhp.toString()) : dec("0");
  await db.payment.update({ where: { id: p.id }, data: { pdaxFeePhp: feePhp.toFixed(2) } });
  await applyTransition(db, p, PaymentStatus.PDAX_TRADED, { pdaxFeePhp: feePhp.toFixed(2) });
}

// PDAX_TRADED → PAYOUT_SUBMITTED (decrypt bank acct in-memory)
async function stepRequestPayout(p: PaymentWithRels): Promise<void> {
  let payoutRef = p.pdaxCashoutRef;
  if (!payoutRef) {
    const accountNumber = decryptSecret(p.merchant.accountNumber);
    const res = await withRetry(
      () =>
        rail.cashOutPhpToBank({
          ref: p.reference,
          phpAmount: dec(p.amountPhp.toString()),
          bank: {
            bankCode: p.merchant.settlementBankCode,
            accountName: p.merchant.accountName,
            accountNumber,
          },
        }),
      { label: "cashOutPhpToBank" },
    );
    payoutRef = res.payoutRef;
    await db.payment.update({ where: { id: p.id }, data: { pdaxCashoutRef: payoutRef } });
  }
  await applyTransition(db, p, PaymentStatus.PAYOUT_SUBMITTED, { pdaxCashoutRef: payoutRef });
}

// PAYOUT_SUBMITTED → SETTLED (poll; FAILED state throws → refund)
async function stepPollPayout(p: PaymentWithRels): Promise<void> {
  const status = await pollUntil(
    () => rail.getPayoutStatus(p.pdaxCashoutRef!),
    (s) => s.state !== "PENDING",
    PAYOUT_POLL,
  );
  if (status.state !== "SETTLED") throw new Error(`PDAX payout ${p.pdaxCashoutRef} failed`);
  const netPhp = status.netPhp
    ? dec(status.netPhp.toString())
    : dec(p.amountPhp.toString()).minus(p.pdaxFeePhp.toString());
  await db.payment.update({
    where: { id: p.id },
    data: { netSettledPhp: netPhp.toFixed(2), settledAt: new Date() },
  });
  await applyTransition(db, p, PaymentStatus.SETTLED, { netSettledPhp: netPhp.toFixed(2) });
}

// REFUND_PENDING → REFUNDED (credit payer wallet; alert admin)
async function stepRefund(p: PaymentWithRels): Promise<void> {
  const wallet = p.payer.wallet!;
  const total = dec(p.amountXlm.toString()).plus(p.networkFeeXlm.toString());
  await db.$transaction(async (tx) => {
    const existing = await tx.walletTransaction.findFirst({
      where: { paymentId: p.id, type: "REFUND_CREDIT" },
    });
    if (!existing) {
      const w = await tx.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const newBalance = dec(w.cachedXlmBalance.toString()).plus(total);
      await tx.walletTransaction.create({
        data: {
          walletId: w.id,
          type: "REFUND_CREDIT",
          amountXlm: total.toFixed(7),
          balanceAfter: newBalance.toFixed(7),
          paymentId: p.id,
          memo: `refund ${p.reference}`,
        },
      });
      await tx.custodialWallet.update({
        where: { id: w.id },
        data: { cachedXlmBalance: newBalance.toFixed(7) },
      });
    }
    await applyTransition(tx, p, PaymentStatus.REFUNDED, { refundedXlm: total.toFixed(7) });
  });
  await audit({
    action: "payment.refunded",
    target: p.id,
    metadata: {
      reference: p.reference,
      refundedXlm: total.toFixed(7),
      reason: p.failureReason ?? "settlement failed after XLM moved",
    },
  });
}

// --- failure routing ---
async function handleFailure(p: PaymentWithRels, err: unknown): Promise<void> {
  const reason = err instanceof Error ? err.message : String(err);
  const current = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
  if (isTerminal(current.status)) return;

  if (XLM_MOVED.has(current.status)) {
    // XLM already left the wallet → refund branch.
    await db.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: p.id }, data: { failureReason: reason } });
      await applyTransition(tx, current, PaymentStatus.REFUND_PENDING, { failureReason: reason });
    });
    await enqueueSettle(p.id); // drive REFUND_PENDING → REFUNDED
    return;
  }

  // Pre-XLM-move failure → FAILED; release any reservation still held.
  const total = dec(p.amountXlm.toString()).plus(p.networkFeeXlm.toString());
  await db.$transaction(async (tx) => {
    if (
      current.status === PaymentStatus.AUTHORIZED ||
      current.status === PaymentStatus.STELLAR_SUBMITTED
    ) {
      await releaseReservation(tx, p.payer.wallet!.id, total);
    }
    await tx.payment.update({ where: { id: p.id }, data: { failureReason: reason } });
    await applyTransition(tx, current, PaymentStatus.FAILED, { failureReason: reason });
  });
}

async function releaseReservation(
  tx: TxClient,
  walletId: string,
  total: import("@/lib/money").Decimal,
): Promise<void> {
  const w = await tx.custodialWallet.findUniqueOrThrow({ where: { id: walletId } });
  const next = dec(w.reservedXlm.toString()).minus(total);
  await tx.custodialWallet.update({
    where: { id: walletId },
    data: { reservedXlm: (next.isNegative() ? dec("0") : next).toFixed(7) },
  });
}
```

> Note on the `drive()` test loop: the REFUND test relies on `handleFailure` setting `REFUND_PENDING`, after which the loop re-invokes `processSettleJob` (status `REFUND_PENDING` → `stepRefund`). In production the `enqueueSettle(p.id)` call inside `handleFailure` does the re-drive; in tests `enqueueSettle` is mocked to a no-op and the loop advances it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/server/queue/jobs/settle.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/queue/jobs/settle.ts src/server/queue/jobs/settle.test.ts
git commit -m "feat(worker): add resumable settlement processor (stellar→trade→payout, refund branch)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Deposit poller (`jobs/deposit-poller.ts`)

**Files:**

- Create: `src/server/queue/jobs/deposit-poller.ts`
- Test: `src/server/queue/jobs/deposit-poller.test.ts`

**Interfaces:**

- Consumes: `db`, `walletService.listIncomingPayments` (`@/server/stellar/wallet`), `redis` (`@/server/redis` — ioredis singleton for the persisted Horizon cursor), `dec` (`@/lib/money`).
- Produces:
  ```typescript
  import { Decimal } from "@/lib/money";
  // Sync one wallet's incoming Horizon payments → PREFUND_DEPOSIT rows + cachedXlmBalance.
  // Cursor persisted in Redis (`horizon:cursor:<walletId>`). Idempotent by stellarTxHash.
  export function syncWalletDeposits(
    walletId: string,
  ): Promise<{ balanceXlm: Decimal; newDeposits: number }>;
  // Repeatable job: sync every wallet.
  export function processDepositPollJob(): Promise<void>;
  ```

> Cursor storage: the Prisma schema (SPEC §4) has no cursor column on `CustodialWallet`, so the Horizon cursor is persisted in Redis (`horizon:cursor:<walletId>`) — no schema change. This satisfies SPEC §7.1 "cursor persisted".

- [ ] **Step 1: Write the failing test**

```typescript
// src/server/queue/jobs/deposit-poller.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, makePayer } from "../../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";

const listIncomingPayments = vi.fn();
vi.mock("@/server/stellar/wallet", () => ({
  walletService: { listIncomingPayments: (pk: string, c?: string) => listIncomingPayments(pk, c) },
}));

// In-memory Redis stub for the cursor.
const store = new Map<string, string>();
vi.mock("@/server/redis", () => ({
  redis: {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
      return "OK";
    }),
  },
}));

import { syncWalletDeposits } from "./deposit-poller";

describe("syncWalletDeposits", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    store.clear();
    await resetDb();
  });

  it("credits a new deposit exactly once (idempotent by stellarTxHash)", async () => {
    const { wallet } = await makePayer({ cachedXlm: "0.0000000" });
    listIncomingPayments.mockResolvedValue({
      items: [
        {
          id: "op1",
          amountXlm: dec("25"),
          from: "GSENDER",
          txHash: "DEPOSITHASH1",
          createdAt: new Date(),
        },
      ],
      cursor: "cursor-1",
    });

    const first = await syncWalletDeposits(wallet.id);
    expect(first.newDeposits).toBe(1);
    expect(first.balanceXlm.toFixed(7)).toBe("25.0000000");

    // Second run returns the same payment again → must NOT double-credit.
    const second = await syncWalletDeposits(wallet.id);
    expect(second.newDeposits).toBe(0);

    const txs = await db.walletTransaction.findMany({
      where: { walletId: wallet.id, type: "PREFUND_DEPOSIT" },
    });
    expect(txs).toHaveLength(1);
    expect(txs[0].amountXlm.toFixed(7)).toBe("25.0000000");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.cachedXlmBalance.toFixed(7)).toBe("25.0000000");
    expect(w.lastSyncedAt).not.toBeNull();
  });

  it("passes the persisted cursor on subsequent calls", async () => {
    const { wallet } = await makePayer();
    listIncomingPayments.mockResolvedValue({ items: [], cursor: "cursor-9" });
    await syncWalletDeposits(wallet.id);
    await syncWalletDeposits(wallet.id);
    expect(listIncomingPayments).toHaveBeenLastCalledWith(wallet.stellarPublicKey, "cursor-9");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/queue/jobs/deposit-poller.test.ts`
Expected: FAIL — `Cannot find module './deposit-poller'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/server/queue/jobs/deposit-poller.ts
import "server-only";
import { Prisma } from "@/generated/prisma";
import { db } from "@/server/db";
import { redis } from "@/server/redis";
import { walletService } from "@/server/stellar/wallet";
import { dec, Decimal } from "@/lib/money";

const cursorKey = (walletId: string) => `horizon:cursor:${walletId}`;

export async function syncWalletDeposits(
  walletId: string,
): Promise<{ balanceXlm: Decimal; newDeposits: number }> {
  const wallet = await db.custodialWallet.findUniqueOrThrow({ where: { id: walletId } });
  const cursor = (await redis.get(cursorKey(walletId))) ?? undefined;
  const { items, cursor: newCursor } = await walletService.listIncomingPayments(
    wallet.stellarPublicKey,
    cursor,
  );

  let newDeposits = 0;
  let balance = dec(wallet.cachedXlmBalance.toString());

  for (const item of items) {
    // Idempotent: stellarTxHash is @unique on WalletTransaction.
    const exists = await db.walletTransaction.findUnique({ where: { stellarTxHash: item.txHash } });
    if (exists) continue;
    const amount = dec(item.amountXlm.toString());
    const after = balance.plus(amount);
    try {
      await db.$transaction(async (tx) => {
        await tx.walletTransaction.create({
          data: {
            walletId,
            type: "PREFUND_DEPOSIT",
            amountXlm: amount.toFixed(7),
            balanceAfter: after.toFixed(7),
            stellarTxHash: item.txHash,
            memo: `deposit from ${item.from}`,
          },
        });
        await tx.custodialWallet.update({
          where: { id: walletId },
          data: { cachedXlmBalance: after.toFixed(7) },
        });
      });
      balance = after;
      newDeposits++;
    } catch (err) {
      // Concurrent insert of the same txHash → ignore (already credited).
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }

  if (newCursor) await redis.set(cursorKey(walletId), newCursor);
  await db.custodialWallet.update({ where: { id: walletId }, data: { lastSyncedAt: new Date() } });
  return { balanceXlm: balance, newDeposits };
}

export async function processDepositPollJob(): Promise<void> {
  const wallets = await db.custodialWallet.findMany({ select: { id: true } });
  for (const w of wallets) {
    try {
      await syncWalletDeposits(w.id);
    } catch (err) {
      console.error("[deposit-poll] wallet sync failed", {
        walletId: w.id,
        error: (err as Error).message,
      });
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/server/queue/jobs/deposit-poller.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/queue/jobs/deposit-poller.ts src/server/queue/jobs/deposit-poller.test.ts
git commit -m "feat(worker): add deposit poller (Horizon cursor, idempotent PREFUND_DEPOSIT)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Reconciliation job (`jobs/reconcile.ts`)

**Files:**

- Create: `src/server/queue/jobs/reconcile.ts`
- Test: `src/server/queue/jobs/reconcile.test.ts`

**Interfaces:**

- Consumes: `db`, `walletService.getBalance` (`@/server/stellar/wallet`), `audit` (`@/server/auth/audit`), `dec` (`@/lib/money`).
- Produces:
  ```typescript
  // Diff each wallet's cached balance + ledger sum vs Horizon; flag drift to admin (AuditLog "reconcile.drift").
  export function processReconcileJob(): Promise<{ checked: number; drift: number }>;
  ```

> Scope: this reconciles the **XLM** source of truth (Horizon) vs the local cache/ledger (SPEC §9). PDAX (PHP) ledger reconciliation is gated behind a future provider capability (the locked `PaymentRailProvider` exposes no transaction-listing method); leave a `// TODO(pdax-reconcile)` note. Drift is flagged, never auto-corrected.

- [ ] **Step 1: Write the failing test**

```typescript
// src/server/queue/jobs/reconcile.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, makePayer } from "../../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";

const getBalance = vi.fn();
vi.mock("@/server/stellar/wallet", () => ({
  walletService: { getBalance: (pk: string) => getBalance(pk) },
}));

import { processReconcileJob } from "./reconcile";

describe("processReconcileJob", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDb();
  });

  it("flags drift between cached balance and Horizon to AuditLog", async () => {
    const { wallet } = await makePayer({ cachedXlm: "10.0000000" });
    getBalance.mockResolvedValue(dec("9")); // Horizon says 9, cache says 10 → drift

    const res = await processReconcileJob();
    expect(res.checked).toBe(1);
    expect(res.drift).toBe(1);

    const logs = await db.auditLog.findMany({
      where: { action: "reconcile.drift", target: wallet.id },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].metadata).toMatchObject({ cachedXlm: "10.0000000", horizonXlm: "9.0000000" });
  });

  it("records no drift when balances match", async () => {
    await makePayer({ cachedXlm: "10.0000000" });
    getBalance.mockResolvedValue(dec("10"));
    const res = await processReconcileJob();
    expect(res.drift).toBe(0);
    expect(await db.auditLog.count({ where: { action: "reconcile.drift" } })).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/server/queue/jobs/reconcile.test.ts`
Expected: FAIL — `Cannot find module './reconcile'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/server/queue/jobs/reconcile.ts
import "server-only";
import { db } from "@/server/db";
import { walletService } from "@/server/stellar/wallet";
import { audit } from "@/server/auth/audit";
import { dec } from "@/lib/money";

// TODO(pdax-reconcile): once PaymentRailProvider exposes transaction listing, diff PDAX history vs local Payments.

export async function processReconcileJob(): Promise<{ checked: number; drift: number }> {
  const wallets = await db.custodialWallet.findMany();
  let drift = 0;

  for (const wallet of wallets) {
    let horizon;
    try {
      horizon = await walletService.getBalance(wallet.stellarPublicKey);
    } catch (err) {
      console.error("[reconcile] getBalance failed", {
        walletId: wallet.id,
        error: (err as Error).message,
      });
      continue;
    }
    const cached = dec(wallet.cachedXlmBalance.toString());
    if (!cached.equals(horizon)) {
      drift++;
      await audit({
        action: "reconcile.drift",
        target: wallet.id,
        metadata: {
          publicKey: wallet.stellarPublicKey,
          cachedXlm: cached.toFixed(7),
          horizonXlm: horizon.toFixed(7),
          deltaXlm: horizon.minus(cached).toFixed(7),
        },
      });
    }
  }

  return { checked: wallets.length, drift };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/server/queue/jobs/reconcile.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/queue/jobs/reconcile.ts src/server/queue/jobs/reconcile.test.ts
git commit -m "feat(worker): add reconciliation job (wallet cache vs Horizon drift → AuditLog)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Worker entrypoint (`src/worker/index.ts`)

**Files:**

- Create: `src/worker/index.ts`
- Modify: `package.json` (add `worker:dev` / `worker:start` scripts)
- Test: none (thin wiring; covered by job-processor unit tests + e2e in Phase 9). Verify it boots.

**Interfaces:**

- Consumes: `Worker` (`bullmq`), `bullConnection`/`QUEUE_NAMES`/`depositPollQueue`/`reconcileQueue` (`@/server/queue/queues`), `processSettleJob`/`processDepositPollJob`/`processReconcileJob` (jobs), `ensureBucket` (`@/server/storage/s3` — Phase 3 storage bootstrap).
- Produces: a long-running process with three Workers + two repeatable jobs + graceful shutdown.

> `ensureBucket()` is the MinIO/S3 bucket bootstrap from Phase 3 (`AGENT.md §9` "create the MinIO bucket on startup"). If Phase 3 did not export it, add `export async function ensureBucket(): Promise<void>` to `src/server/storage/s3.ts` (create-bucket-if-missing) as the first step of this task.

- [ ] **Step 1: Write the worker entrypoint**

```typescript
// src/worker/index.ts
import "server-only";
import { Worker } from "bullmq";
import {
  QUEUE_NAMES,
  bullConnection,
  depositPollQueue,
  reconcileQueue,
} from "@/server/queue/queues";
import { processSettleJob } from "@/server/queue/jobs/settle";
import { processDepositPollJob } from "@/server/queue/jobs/deposit-poller";
import { processReconcileJob } from "@/server/queue/jobs/reconcile";
import { ensureBucket } from "@/server/storage/s3";

async function main() {
  await ensureBucket(); // bucket bootstrap (MinIO dev / S3 prod)

  const settleWorker = new Worker(
    QUEUE_NAMES.settle,
    async (job) => {
      await processSettleJob({ data: job.data as { paymentId: string } });
    },
    { connection: bullConnection, concurrency: 5 },
  );
  const depositWorker = new Worker(
    QUEUE_NAMES.depositPoll,
    async () => {
      await processDepositPollJob();
    },
    { connection: bullConnection, concurrency: 1 },
  );
  const reconcileWorker = new Worker(
    QUEUE_NAMES.reconcile,
    async () => {
      await processReconcileJob();
    },
    { connection: bullConnection, concurrency: 1 },
  );

  for (const w of [settleWorker, depositWorker, reconcileWorker]) {
    w.on("failed", (job, err) =>
      console.error(`[worker] ${w.name} job ${job?.id} failed`, err.message),
    );
  }

  // Repeatable jobs (idempotent processors). jobId keeps a single repeatable schedule.
  await depositPollQueue.add("poll", {}, { repeat: { every: 30_000 }, jobId: "deposit-poll-cron" });
  await reconcileQueue.add(
    "reconcile",
    {},
    { repeat: { every: 5 * 60_000 }, jobId: "reconcile-cron" },
  );

  console.log("[worker] started: settle, deposit-poll, reconcile");

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received, shutting down`);
    await Promise.allSettled([
      settleWorker.close(),
      depositWorker.close(),
      reconcileWorker.close(),
    ]);
    await bullConnection.quit();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add worker scripts to `package.json`**

```jsonc
// package.json "scripts" — add:
"worker:dev": "tsx watch src/worker/index.ts",
"worker:start": "node --import tsx src/worker/index.ts"
```

- [ ] **Step 3: Verify the worker boots (manual smoke check)**

Run: `docker compose up -d postgres redis && PAYMENT_RAIL=mock pnpm worker:dev`
Expected: logs `[worker] started: settle, deposit-poll, reconcile` and stays running; `Ctrl-C` logs `SIGINT received, shutting down` and exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/worker/index.ts package.json
git commit -m "feat(worker): add worker entrypoint (workers, repeatable jobs, graceful shutdown)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Wallet API routes

**Files:**

- Create: `src/app/api/wallet/route.ts` (GET)
- Create: `src/app/api/wallet/deposit-address/route.ts` (GET)
- Create: `src/app/api/wallet/sync/route.ts` (POST)
- Create: `src/app/api/wallet/transactions/route.ts` (GET)
- Test: `tests/integration/wallet.test.ts`

**Interfaces:**

- Consumes: `route`/`json`/`parseQuery` (`@/lib/http`), `requireUser` (`@/server/auth/sessions`), `assertSameOrigin` (`@/server/auth/csrf`), `db`, `dec`/`availableXlm`/`displayPhp`/`Decimal` (`@/lib/money`), `rail.getQuote` (for approxPhp), `syncWalletDeposits` (`@/server/queue/jobs/deposit-poller`), `notFound`/`conflict` (`@/lib/errors`), `qrcode` (deposit QR SVG).
- Produces (response shapes per SPEC §6):
  ```typescript
  // GET /api/wallet → { publicKey, balanceXlm, reservedXlm, availableXlm, approxPhp }
  // GET /api/wallet/deposit-address → { publicKey, qrSvg, network:"stellar", memoRequired:false }
  // POST /api/wallet/sync → { balanceXlm }
  // GET /api/wallet/transactions?cursor=&limit= → { items, nextCursor }
  ```

> All four handlers call `requireUser()` (re-check auth, default-deny) and operate only on the caller's own wallet (ownership). `sync` is non-GET → `assertSameOrigin(req)`.

- [ ] **Step 1: Write the failing integration test**

```typescript
// tests/integration/wallet.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, makePayer } from "../helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";

const sessionUser = {
  current: null as null | { id: string; username: string; role: "PAYER"; isActive: boolean },
};
vi.mock("@/server/auth/sessions", () => ({
  requireUser: vi.fn(async () => {
    if (!sessionUser.current)
      throw new (require("@/lib/errors").AppError)("unauthorized", "no session", 401);
    return sessionUser.current;
  }),
}));
vi.mock("@/server/rails", () => ({
  rail: {
    getQuote: vi.fn(async () => ({
      rate: dec("12"),
      phpAmount: dec("0"),
      xlmAmount: dec("0"),
      expiresAt: new Date(),
    })),
  },
}));
const syncWalletDeposits = vi.fn(async () => ({ balanceXlm: dec("42"), newDeposits: 1 }));
vi.mock("@/server/queue/jobs/deposit-poller", () => ({
  syncWalletDeposits: (id: string) => syncWalletDeposits(id),
}));

import { GET as getWallet } from "@/app/api/wallet/route";
import { POST as postSync } from "@/app/api/wallet/sync/route";
import { GET as getTxns } from "@/app/api/wallet/transactions/route";

const noParams = { params: Promise.resolve({}) };

describe("wallet API", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDb();
  });

  it("GET /api/wallet returns balance, reserved, available and approxPhp", async () => {
    const { user, wallet } = await makePayer({ cachedXlm: "10.0000000", reservedXlm: "2.0000000" });
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
    const res = await getWallet(new NextRequest("http://localhost/api/wallet"), noParams);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      publicKey: wallet.stellarPublicKey,
      balanceXlm: "10.0000000",
      reservedXlm: "2.0000000",
      availableXlm: "8.0000000",
    });
  });

  it("POST /api/wallet/sync reconciles via syncWalletDeposits", async () => {
    const { user } = await makePayer();
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
    const req = new NextRequest("http://localhost/api/wallet/sync", {
      method: "POST",
      headers: { origin: "http://localhost", "sec-fetch-site": "same-origin" },
    });
    const res = await postSync(req, noParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ balanceXlm: "42.0000000" });
    expect(syncWalletDeposits).toHaveBeenCalledOnce();
  });

  it("GET /api/wallet/transactions paginates by cursor", async () => {
    const { user, wallet } = await makePayer();
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
    for (let i = 0; i < 3; i++) {
      await db.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "PREFUND_DEPOSIT",
          amountXlm: "1.0000000",
          balanceAfter: `${i + 1}.0000000`,
          stellarTxHash: `H${i}`,
        },
      });
    }
    const res = await getTxns(
      new NextRequest("http://localhost/api/wallet/transactions?limit=2"),
      noParams,
    );
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).toBeTruthy();
    const res2 = await getTxns(
      new NextRequest(`http://localhost/api/wallet/transactions?limit=2&cursor=${body.nextCursor}`),
      noParams,
    );
    const body2 = await res2.json();
    expect(body2.items).toHaveLength(1);
    expect(body2.nextCursor).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/wallet.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/wallet/route'`.

- [ ] **Step 3: Implement `GET /api/wallet`**

```typescript
// src/app/api/wallet/route.ts
import { route, json } from "@/lib/http";
import { requireUser } from "@/server/auth/sessions";
import { db } from "@/server/db";
import { dec, availableXlm, displayPhp } from "@/lib/money";
import { rail } from "@/server/rails";
import { notFound } from "@/lib/errors";

export const GET = route(async () => {
  const user = await requireUser();
  const wallet = await db.custodialWallet.findUnique({ where: { userId: user.id } });
  if (!wallet) throw notFound("wallet not found");

  const balance = dec(wallet.cachedXlmBalance.toString());
  const reserved = dec(wallet.reservedXlm.toString());
  const available = availableXlm(balance, reserved);

  let approxPhp = "0.00";
  try {
    const quote = await rail.getQuote({ sell: "XLM", buy: "PHP", phpAmount: dec("1") });
    approxPhp = displayPhp(available.times(quote.rate));
  } catch {
    // Rate unavailable → omit approximation rather than failing the balance read.
  }

  return json({
    publicKey: wallet.stellarPublicKey,
    balanceXlm: balance.toFixed(7),
    reservedXlm: reserved.toFixed(7),
    availableXlm: available.toFixed(7),
    approxPhp,
  });
});
```

- [ ] **Step 4: Implement `GET /api/wallet/deposit-address`**

```typescript
// src/app/api/wallet/deposit-address/route.ts
import QRCode from "qrcode";
import { route, json } from "@/lib/http";
import { requireUser } from "@/server/auth/sessions";
import { db } from "@/server/db";
import { notFound } from "@/lib/errors";

export const GET = route(async () => {
  const user = await requireUser();
  const wallet = await db.custodialWallet.findUnique({ where: { userId: user.id } });
  if (!wallet) throw notFound("wallet not found");
  const qrSvg = await QRCode.toString(wallet.stellarPublicKey, { type: "svg", margin: 1 });
  return json({
    publicKey: wallet.stellarPublicKey,
    qrSvg,
    network: "stellar",
    memoRequired: false,
  });
});
```

- [ ] **Step 5: Implement `POST /api/wallet/sync`**

```typescript
// src/app/api/wallet/sync/route.ts
import { route, json } from "@/lib/http";
import { requireUser } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { db } from "@/server/db";
import { syncWalletDeposits } from "@/server/queue/jobs/deposit-poller";
import { notFound } from "@/lib/errors";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const wallet = await db.custodialWallet.findUnique({ where: { userId: user.id } });
  if (!wallet) throw notFound("wallet not found");
  const { balanceXlm } = await syncWalletDeposits(wallet.id);
  return json({ balanceXlm: balanceXlm.toFixed(7) });
});
```

- [ ] **Step 6: Implement `GET /api/wallet/transactions`**

```typescript
// src/app/api/wallet/transactions/route.ts
import { z } from "zod";
import { route, json, parseQuery } from "@/lib/http";
import { requireUser } from "@/server/auth/sessions";
import { db } from "@/server/db";
import { notFound } from "@/lib/errors";

const querySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = route(async (req) => {
  const user = await requireUser();
  const wallet = await db.custodialWallet.findUnique({ where: { userId: user.id } });
  if (!wallet) throw notFound("wallet not found");
  const { cursor, limit } = parseQuery(req, querySchema);

  const rows = await db.walletTransaction.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((t) => ({
    id: t.id,
    type: t.type,
    amountXlm: t.amountXlm.toFixed(7),
    balanceAfter: t.balanceAfter.toFixed(7),
    stellarTxHash: t.stellarTxHash,
    paymentId: t.paymentId,
    memo: t.memo,
    createdAt: t.createdAt.toISOString(),
  }));
  return json({ items, nextCursor: hasMore ? rows[limit - 1].id : null });
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run tests/integration/wallet.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add src/app/api/wallet tests/integration/wallet.test.ts
git commit -m "feat(api): add wallet routes (balance, deposit-address, sync, transactions)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: QRPH decode route

**Files:**

- Create: `src/app/api/qrph/decode/route.ts` (POST)
- Test: `tests/integration/qrph-decode.test.ts`

**Interfaces:**

- Consumes: `route`/`json`/`parseBody` (`@/lib/http`), `requireRole` (`@/server/auth/sessions`), `assertSameOrigin` (`@/server/auth/csrf`), `decodeQrph`/`decodeQrphImage` (`@/server/qrph/decode`), `resolveMerchant` (`@/server/qrph/resolve`), `badRequest` (`@/lib/errors`).
- Produces:
  ```typescript
  // POST /api/qrph/decode  body { raw } OR multipart { image }
  // → { decoded, merchant? }  (merchant = { id, businessName, qrphMerchantName, amountPhp? } or null)
  ```

> Payer-only (`requireRole("PAYER")`); non-GET → `assertSameOrigin`. Authoritative server-side CRC validation + merchant resolution (SPEC §7.3). Returns `merchant: null` (200) when no registered ACTIVE merchant matches, so the UI can show "merchant not registered".

- [ ] **Step 1: Write the failing integration test**

```typescript
// tests/integration/qrph-decode.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, makePayer, makeMerchant } from "../helpers/db";

const sessionUser = {
  current: null as null | { id: string; username: string; role: "PAYER"; isActive: boolean },
};
vi.mock("@/server/auth/sessions", () => ({
  requireRole: vi.fn(async () => {
    if (!sessionUser.current) throw new (require("@/lib/errors").AppError)("forbidden", "no", 403);
    return sessionUser.current;
  }),
}));

const decodeQrph = vi.fn();
vi.mock("@/server/qrph/decode", () => ({
  decodeQrph: (raw: string) => decodeQrph(raw),
  decodeQrphImage: vi.fn(),
}));
const resolveMerchant = vi.fn();
vi.mock("@/server/qrph/resolve", () => ({ resolveMerchant: (d: unknown) => resolveMerchant(d) }));

import { POST as decode } from "@/app/api/qrph/decode/route";
const noParams = { params: Promise.resolve({}) };
const post = (body: unknown) =>
  new NextRequest("http://localhost/api/qrph/decode", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("POST /api/qrph/decode", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDb();
  });

  it("decodes raw and returns the resolved merchant", async () => {
    const { user } = await makePayer();
    const { merchant } = await makeMerchant();
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
    decodeQrph.mockReturnValue({
      raw: "X",
      pointOfInit: "dynamic",
      currency: "608",
      country: "PH",
      crcValid: true,
      amountPhp: "100",
    });
    resolveMerchant.mockResolvedValue(merchant);

    const res = await decode(post({ raw: "X" }), noParams);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.decoded.amountPhp).toBe("100");
    expect(body.merchant).toMatchObject({ id: merchant.id, businessName: "Test Store" });
  });

  it("returns merchant: null when unresolved", async () => {
    const { user } = await makePayer();
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
    decodeQrph.mockReturnValue({
      raw: "X",
      pointOfInit: "static",
      currency: "608",
      country: "PH",
      crcValid: true,
    });
    resolveMerchant.mockResolvedValue(null);
    const res = await decode(post({ raw: "X" }), noParams);
    const body = await res.json();
    expect(body.merchant).toBeNull();
  });

  it("rejects a body with neither raw nor image (400)", async () => {
    const { user } = await makePayer();
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
    const res = await decode(post({}), noParams);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/qrph-decode.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/qrph/decode/route'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/api/qrph/decode/route.ts
import { z } from "zod";
import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { decodeQrph, decodeQrphImage, type QrphDecoded } from "@/server/qrph/decode";
import { resolveMerchant } from "@/server/qrph/resolve";
import { badRequest } from "@/lib/errors";

const rawSchema = z.object({ raw: z.string().min(1) });

export const POST = route(async (req) => {
  assertSameOrigin(req);
  await requireRole("PAYER");

  const contentType = req.headers.get("content-type") ?? "";
  let decoded: QrphDecoded;

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const image = form.get("image");
    if (!(image instanceof File)) throw badRequest("image file is required");
    const buffer = Buffer.from(await image.arrayBuffer());
    decoded = await decodeQrphImage(buffer);
  } else {
    const parsed = rawSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) throw badRequest("provide `raw` (string) or an `image` upload");
    decoded = decodeQrph(parsed.data.raw);
  }

  const merchant = await resolveMerchant(decoded);
  return json({
    decoded,
    merchant: merchant
      ? {
          id: merchant.id,
          businessName: merchant.businessName,
          qrphMerchantName: merchant.qrphMerchantName,
          amountPhp: decoded.amountPhp ?? null,
        }
      : null,
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/integration/qrph-decode.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/qrph tests/integration/qrph-decode.test.ts
git commit -m "feat(api): add qrph decode route (raw/image, CRC, merchant resolution)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: Payments API routes (quote / confirm / get / cancel / stream)

**Files:**

- Create: `src/app/api/payments/quote/route.ts` (POST)
- Create: `src/app/api/payments/[id]/confirm/route.ts` (POST)
- Create: `src/app/api/payments/[id]/route.ts` (GET)
- Create: `src/app/api/payments/[id]/cancel/route.ts` (POST)
- Create: `src/app/api/payments/[id]/stream/route.ts` (GET, SSE)
- Test: `tests/integration/payments.test.ts`

**Interfaces:**

- Consumes: `route`/`json`/`parseBody` (`@/lib/http`), `requireRole`/`requireUser` (`@/server/auth/sessions`), `assertSameOrigin` (`@/server/auth/csrf`), `rateLimit` (`@/server/auth/rate-limit`), `createQuote` (Task 4), `confirmPayment` (Task 5), `applyTransition` (Task 3), `db`, `dec`/`displayPhp` (`@/lib/money`), `notFound`/`forbidden`/`conflict`/`badRequest` (`@/lib/errors`).
- Produces (SPEC §6):
  ```typescript
  // POST /api/payments/quote { merchantId, amountPhp } → { paymentId, amountPhp, rate, amountXlm, networkFeeXlm, quoteExpiresAt }
  // POST /api/payments/[id]/confirm {} + Idempotency-Key → { paymentId, status }
  // GET  /api/payments/[id] → { payment, events }   (ownership: payer)
  // POST /api/payments/[id]/cancel → { status }      (only before STELLAR_SUBMITTED)
  // GET  /api/payments/[id]/stream → text/event-stream of { status } until terminal
  ```

> `quote` + `confirm` are rate-limited per user (`AGENT §5/§6` anti-automation) and CSRF-checked. `confirm` requires the `Idempotency-Key` header (passed to `confirmPayment`). Every handler enforces ownership (payer owns the payment).

- [ ] **Step 1: Write the failing integration test (quote → confirm → poll + cancel)**

```typescript
// tests/integration/payments.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { resetDb, makePayer, makeMerchant } from "../helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";

const sessionUser = {
  current: null as null | { id: string; username: string; role: "PAYER"; isActive: boolean },
};
vi.mock("@/server/auth/sessions", () => ({
  requireRole: vi.fn(async () => {
    if (!sessionUser.current) throw new (require("@/lib/errors").AppError)("forbidden", "no", 403);
    return sessionUser.current;
  }),
  requireUser: vi.fn(async () => {
    if (!sessionUser.current)
      throw new (require("@/lib/errors").AppError)("unauthorized", "no", 401);
    return sessionUser.current;
  }),
}));
vi.mock("@/server/auth/rate-limit", () => ({ rateLimit: vi.fn(async () => {}) }));
vi.mock("@/server/rails", () => ({
  rail: {
    getQuote: vi.fn(async ({ phpAmount }: { phpAmount: import("@/lib/money").Decimal }) => ({
      rate: dec("12"),
      phpAmount,
      xlmAmount: phpAmount.div(12),
      expiresAt: new Date(Date.now() + 90_000),
    })),
  },
}));
const enqueueSettle = vi.fn(async () => {});
vi.mock("@/server/queue/queues", () => ({
  QUEUE_NAMES: { settle: "settle", depositPoll: "deposit-poll", reconcile: "reconcile" },
  enqueueSettle: (id: string) => enqueueSettle(id),
}));

import { POST as quote } from "@/app/api/payments/quote/route";
import { POST as confirm } from "@/app/api/payments/[id]/confirm/route";
import { GET as getPayment } from "@/app/api/payments/[id]/route";
import { POST as cancel } from "@/app/api/payments/[id]/cancel/route";

const sameOrigin = {
  origin: "http://localhost",
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
};

describe("payments API", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDb();
  });

  it("quote → confirm → poll happy path", async () => {
    const { user } = await makePayer({ cachedXlm: "100.0000000" });
    const { merchant } = await makeMerchant();
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };

    const qRes = await quote(
      new NextRequest("http://localhost/api/payments/quote", {
        method: "POST",
        headers: sameOrigin,
        body: JSON.stringify({ merchantId: merchant.id, amountPhp: "100" }),
      }),
      { params: Promise.resolve({}) },
    );
    const q = await qRes.json();
    expect(qRes.status).toBe(200);
    expect(q.amountXlm).toBe("8.3333334");

    const cRes = await confirm(
      new NextRequest(`http://localhost/api/payments/${q.paymentId}/confirm`, {
        method: "POST",
        headers: { ...sameOrigin, "idempotency-key": randomUUID() },
        body: "{}",
      }),
      { params: Promise.resolve({ id: q.paymentId }) },
    );
    expect(cRes.status).toBe(200);
    expect(await cRes.json()).toEqual({ paymentId: q.paymentId, status: "AUTHORIZED" });
    expect(enqueueSettle).toHaveBeenCalledWith(q.paymentId);

    const gRes = await getPayment(new NextRequest(`http://localhost/api/payments/${q.paymentId}`), {
      params: Promise.resolve({ id: q.paymentId }),
    });
    const g = await gRes.json();
    expect(g.payment.status).toBe("AUTHORIZED");
    expect(g.events.length).toBeGreaterThanOrEqual(2); // CREATED→QUOTED, QUOTED→AUTHORIZED
  });

  it("confirm without Idempotency-Key → 400", async () => {
    const { user } = await makePayer();
    const { merchant } = await makeMerchant();
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
    const p = await db.payment.create({
      data: {
        reference: "TXN-AAAAAAAA",
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: "100.00",
        quotedRate: "12.00000000",
        amountXlm: "8.3333334",
        networkFeeXlm: "0.0000100",
        status: "QUOTED",
        quoteExpiresAt: new Date(Date.now() + 90_000),
      },
    });
    const res = await confirm(
      new NextRequest(`http://localhost/api/payments/${p.id}/confirm`, {
        method: "POST",
        headers: sameOrigin,
        body: "{}",
      }),
      { params: Promise.resolve({ id: p.id }) },
    );
    expect(res.status).toBe(400);
  });

  it("GET another user's payment → 403", async () => {
    const { user } = await makePayer();
    const { merchant } = await makeMerchant();
    const p = await db.payment.create({
      data: {
        reference: "TXN-BBBBBBBB",
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: "100.00",
        quotedRate: "12.00000000",
        amountXlm: "8.3333334",
        networkFeeXlm: "0.0000100",
        status: "QUOTED",
      },
    });
    const { user: stranger } = await makePayer();
    sessionUser.current = {
      id: stranger.id,
      username: stranger.username,
      role: "PAYER",
      isActive: true,
    };
    const res = await getPayment(new NextRequest(`http://localhost/api/payments/${p.id}`), {
      params: Promise.resolve({ id: p.id }),
    });
    expect(res.status).toBe(403);
  });

  it("cancel a QUOTED payment releases nothing and marks FAILED; cannot cancel after STELLAR_SUBMITTED", async () => {
    const { user, wallet } = await makePayer({
      cachedXlm: "100.0000000",
      reservedXlm: "8.3333434",
    });
    const { merchant } = await makeMerchant();
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
    const authd = await db.payment.create({
      data: {
        reference: "TXN-CCCCCCCC",
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: "100.00",
        quotedRate: "12.00000000",
        amountXlm: "8.3333334",
        networkFeeXlm: "0.0000100",
        status: "AUTHORIZED",
      },
    });
    const cRes = await cancel(
      new NextRequest(`http://localhost/api/payments/${authd.id}/cancel`, {
        method: "POST",
        headers: sameOrigin,
      }),
      { params: Promise.resolve({ id: authd.id }) },
    );
    expect((await cRes.json()).status).toBe("FAILED");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000"); // reservation released on cancel

    const submitted = await db.payment.create({
      data: {
        reference: "TXN-DDDDDDDD",
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: "100.00",
        quotedRate: "12.00000000",
        amountXlm: "8.3333334",
        networkFeeXlm: "0.0000100",
        status: "STELLAR_SUBMITTED",
      },
    });
    const c2 = await cancel(
      new NextRequest(`http://localhost/api/payments/${submitted.id}/cancel`, {
        method: "POST",
        headers: sameOrigin,
      }),
      { params: Promise.resolve({ id: submitted.id }) },
    );
    expect(c2.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/payments.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/payments/quote/route'`.

- [ ] **Step 3: Implement `POST /api/payments/quote`**

```typescript
// src/app/api/payments/quote/route.ts
import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { rateLimit } from "@/server/auth/rate-limit";
import { dec } from "@/lib/money";
import { createQuote } from "@/server/payments/quote";

const bodySchema = z.object({
  merchantId: z.string().min(1),
  amountPhp: z
    .union([z.string(), z.number()])
    .transform((v) => dec(v))
    .refine((d) => d.greaterThan(0), "amount must be > 0"),
});

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireRole("PAYER");
  await rateLimit(`quote:user:${user.id}`, { limit: 30, windowSec: 60 });
  const { merchantId, amountPhp } = await parseBody(req, bodySchema);

  const q = await createQuote({ payerId: user.id, merchantId, amountPhp });
  return json({
    paymentId: q.paymentId,
    reference: q.reference,
    amountPhp: q.amountPhp.toFixed(2),
    rate: q.rate.toFixed(8),
    amountXlm: q.amountXlm.toFixed(7),
    networkFeeXlm: q.networkFeeXlm.toFixed(7),
    quoteExpiresAt: q.quoteExpiresAt.toISOString(),
  });
});
```

- [ ] **Step 4: Implement `POST /api/payments/[id]/confirm`**

```typescript
// src/app/api/payments/[id]/confirm/route.ts
import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { rateLimit } from "@/server/auth/rate-limit";
import { confirmPayment } from "@/server/payments/confirm";
import { badRequest } from "@/lib/errors";

export const POST = route(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireRole("PAYER");
  await rateLimit(`confirm:user:${user.id}`, { limit: 20, windowSec: 60 });
  const idemKey = req.headers.get("idempotency-key");
  if (!idemKey) throw badRequest("Idempotency-Key header is required");
  const res = await confirmPayment({ paymentId: ctx.params.id, payerId: user.id, idemKey });
  return json(res);
});
```

- [ ] **Step 5: Implement `GET /api/payments/[id]`**

```typescript
// src/app/api/payments/[id]/route.ts
import { route, json } from "@/lib/http";
import { requireUser } from "@/server/auth/sessions";
import { db } from "@/server/db";
import { notFound, forbidden } from "@/lib/errors";

export const GET = route(async (_req, ctx) => {
  const user = await requireUser();
  const payment = await db.payment.findUnique({
    where: { id: ctx.params.id },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      merchant: { select: { businessName: true } },
    },
  });
  if (!payment) throw notFound("payment not found");
  if (payment.payerId !== user.id && user.role !== "ADMIN") throw forbidden("not your payment");

  return json({
    payment: {
      id: payment.id,
      reference: payment.reference,
      status: payment.status,
      amountPhp: payment.amountPhp.toFixed(2),
      quotedRate: payment.quotedRate.toFixed(8),
      amountXlm: payment.amountXlm.toFixed(7),
      networkFeeXlm: payment.networkFeeXlm.toFixed(7),
      netSettledPhp: payment.netSettledPhp?.toFixed(2) ?? null,
      merchantName: payment.merchant.businessName,
      stellarTxHash: payment.stellarTxHash,
      failureReason: payment.failureReason,
      quoteExpiresAt: payment.quoteExpiresAt?.toISOString() ?? null,
      settledAt: payment.settledAt?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
    },
    events: payment.events.map((e) => ({
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      detail: e.detail,
      createdAt: e.createdAt.toISOString(),
    })),
  });
});
```

- [ ] **Step 6: Implement `POST /api/payments/[id]/cancel`**

```typescript
// src/app/api/payments/[id]/cancel/route.ts
import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { applyTransition } from "@/server/payments/state-machine";
import { notFound, forbidden, conflict } from "@/lib/errors";

// Cancellable only before XLM is submitted on-chain.
const CANCELLABLE = new Set(["CREATED", "QUOTED", "AUTHORIZED"]);

export const POST = route(async (req, ctx) => {
  assertSameOrigin(req);
  const user = await requireRole("PAYER");
  const payment = await db.payment.findUnique({
    where: { id: ctx.params.id },
    include: { payer: { include: { wallet: true } } },
  });
  if (!payment) throw notFound("payment not found");
  if (payment.payerId !== user.id) throw forbidden("not your payment");
  if (!CANCELLABLE.has(payment.status))
    throw conflict(`cannot cancel payment in status ${payment.status}`);

  const updated = await db.$transaction(async (tx) => {
    if (payment.status === "AUTHORIZED" && payment.payer.wallet) {
      // Release the reservation held at confirm.
      const total = dec(payment.amountXlm.toString()).plus(payment.networkFeeXlm.toString());
      const w = await tx.custodialWallet.findUniqueOrThrow({
        where: { id: payment.payer.wallet.id },
      });
      const next = dec(w.reservedXlm.toString()).minus(total);
      await tx.custodialWallet.update({
        where: { id: w.id },
        data: { reservedXlm: (next.isNegative() ? dec("0") : next).toFixed(7) },
      });
    }
    await tx.payment.update({
      where: { id: payment.id },
      data: { failureReason: "cancelled by payer" },
    });
    return applyTransition(tx, payment, "FAILED", { reason: "cancelled by payer" });
  });
  return json({ status: updated.status });
});
```

- [ ] **Step 7: Implement `GET /api/payments/[id]/stream` (SSE)**

```typescript
// src/app/api/payments/[id]/stream/route.ts
import { requireUser } from "@/server/auth/sessions";
import { db } from "@/server/db";
import { isTerminal } from "@/server/payments/state-machine";

// SSE: emit the payment status until it reaches a terminal state. Polls the DB every 1.5s.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const user = await requireUser();
  const payment = await db.payment.findUnique({ where: { id }, select: { payerId: true } });
  if (!payment || (payment.payerId !== user.id && user.role !== "ADMIN")) {
    return new Response("event: error\ndata: forbidden\n\n", {
      status: 403,
      headers: { "content-type": "text/event-stream" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let last = "";
      for (let i = 0; i < 120; i++) {
        // ~3 min cap
        const p = await db.payment.findUnique({ where: { id }, select: { status: true } });
        if (!p) break;
        if (p.status !== last) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: p.status })}\n\n`));
          last = p.status;
        }
        if (isTerminal(p.status)) break;
        await new Promise((r) => setTimeout(r, 1_500));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm vitest run tests/integration/payments.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Run the full Phase 5 suite**

Run: `pnpm vitest run src/server/payments src/server/queue src/lib/retry.test.ts tests/integration`
Expected: PASS (all Phase 5 unit + integration tests).

- [ ] **Step 10: Commit**

```bash
git add src/app/api/payments tests/integration/payments.test.ts
git commit -m "feat(api): add payments routes (quote, confirm, get, cancel, SSE stream)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

Run with fresh eyes against `SPEC.md` §3/§6/§8/§9/§10 and `AGENT.md` §3/§4.

**1. Spec coverage**

- **SPEC §3 settlement state machine** (`CREATED→QUOTED→AUTHORIZED→STELLAR_SUBMITTED→STELLAR_CONFIRMED→PDAX_TRADING→PDAX_TRADED→PAYOUT_SUBMITTED→SETTLED`; `FAILED`; `REFUND_PENDING→REFUNDED`) → Task 3 (`TRANSITIONS`/`nextStep`/`applyTransition`), Task 7 (worker drives every edge; refund branch when XLM moved). "Each transition persisted/idempotent/retried" → `applyTransition` writes `PaymentEvent`; jobs keyed `paymentId:status` (Task 6); `withRetry` (Task 6/7).
- **SPEC §6 wallet endpoints** (`GET /api/wallet`, `/deposit-address`, `POST /sync`, `GET /transactions`) → Task 11. **qrph** (`POST /api/qrph/decode`) → Task 12. **payments** (`quote`, `confirm`+Idempotency-Key, `GET [id]`(+events, +SSE `/stream`), `cancel`) → Task 13. Consistent error envelope + Zod + status codes via `route()`/`parseBody`/`AppError`.
- **SPEC §8.1 prefund** → Task 8 deposit poller (`listIncomingPayments` + persisted cursor → `PREFUND_DEPOSIT` + cached balance). **§8.2 pay flow** → Task 4 (quote: rate lock, fee, funds check, `QUOTED`), Task 5 (confirm: freshness, reserve, `AUTHORIZED`, enqueue, return fast), Task 7 (worker §8.2.4 sub-steps incl. memo=reference, debit+release, trade fee, cash-out with decrypted bank, settled fields, refund branch + admin alert).
- **SPEC §9 money/correctness** → `Decimal` everywhere via `dec(...toString())` + fixed-precision persistence; rate-locking (`quotedRate`, expiry check in confirm); idempotency (`withIdempotencyKey` Task 2 + job ids Task 6); `availableXlm = cached − reserved` checked in both quote and confirm; reconciliation Task 9; Horizon = XLM source of truth (Task 9).
- **SPEC §10 resilience/observability** → `withRetry`/`pollUntil` (Task 6); at-least-once idempotent jobs (Tasks 6–9); `PaymentEvent` trail + `paymentId` in failure logs; reconciliation + drift alerts; graceful shutdown (Task 10).
- **AGENT §3 queue/worker structure** → `src/server/queue/{queues,jobs/*}` + `src/worker/index.ts` (Tasks 6–10), web only enqueues. **AGENT §4 app best practices** → Zod at boundaries (Tasks 11–13), `server-only` on secret modules, `Decimal`-only money, idempotency on money POSTs, async settlement (confirm returns `AUTHORIZED`, UI polls/SSE), external-call retry+poll, cursor pagination (Task 11), error envelope, ownership/default-deny re-checks, `assertSameOrigin` + `rateLimit` on quote/confirm.

**2. Placeholder scan** — No `TBD`/`TODO`(except the intentional, labeled `TODO(pdax-reconcile)` deferral in Task 9, explained in scope)/"add error handling"/"similar to Task N". Every code step shows complete code; every run step shows the exact `pnpm vitest run` command + expected FAIL/PASS.

**3. Type/signature consistency** — Locked contracts consumed verbatim: `newPaymentReference()`, `enqueueSettle(paymentId)` + `QUEUE_NAMES`, `rail.*`, `walletService.*` (`sendXlm`/`confirmTx`/`listIncomingPayments`/`getBalance`), `dec`/`phpToXlm`/`availableXlm`, `AppError`+constructors, `route`/`json`/`parseBody`/`parseQuery`+`HandlerContext.params`, `requireUser`/`requireRole`, `assertSameOrigin`, `rateLimit`, `audit`, `encryptSecret`/`decryptSecret`, `decodeQrph`/`decodeQrphImage`/`resolveMerchant`. Internal names are stable across tasks: `applyTransition(client,payment,toStatus,detail)`, `nextStep`/`isTerminal`/`XLM_MOVED`/`TERMINAL`/`TRANSITIONS` (Task 3) used identically in Tasks 5/7/13; `createQuote`/`CreateQuoteResult` (Task 4) ↔ Task 13; `confirmPayment`/`ConfirmPaymentResult` (Task 5) ↔ Task 13; `withRetry`/`pollUntil` (Task 6) ↔ Task 7; `syncWalletDeposits` (Task 8) ↔ Task 11; `withIdempotencyKey` (Task 2) ↔ Task 5. New shared exports added by this phase (and not in the overview's locked block) are confined to internal modules: `src/lib/retry.ts` (`withRetry`/`pollUntil`), `state-machine.ts` exports, and `STELLAR_BASE_FEE_XLM` — none rename a locked contract.

**Deviations from SPEC (documented):** (a) Horizon deposit cursor persisted in **Redis** (`horizon:cursor:<walletId>`) rather than a DB column, since SPEC §4 schema has none — no migration needed. (b) PDAX-side reconciliation deferred (locked `PaymentRailProvider` exposes no transaction listing); XLM reconciliation implemented now, PDAX gated behind `TODO(pdax-reconcile)`. (c) Cancellation reuses `FAILED` (`failureReason="cancelled by payer"`) since the enum has no `CANCELLED` state.
