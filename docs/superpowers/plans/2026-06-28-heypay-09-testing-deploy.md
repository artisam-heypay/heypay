# Phase 9: Testing, Webhooks & Deployment — HeyPay

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is the final phase: it wires the PDAX webhook + presigned-upload endpoints, the full Playwright e2e suite (run with `PAYMENT_RAIL=mock` + Stellar testnet), the production Docker/Railway/CI configuration, finalizes `.env.example`, and runs every quality gate. Read it alongside `SPEC.md` (§6, §10, §11, §12), `AGENT.md` (§6, §9, §10, §11, §12) and the master overview's **Locked Shared Contracts**.

**Goal:** Make HeyPay shippable: server-to-server webhook + upload endpoints, a green Playwright happy-path suite over the mock rail, reproducible container/CI/Railway config, an authoritative `.env.example`, and a verified quality-gate checklist.

**Architecture:** The PDAX webhook (`POST /api/webhooks/pdax`) and presign endpoint (`POST /api/uploads/presign`) are thin Route Handlers reusing Phase 1–8 services (state machine, storage, idempotency table). e2e tests boot the _production build_ of both the `web` and `worker` processes against a throwaway Postgres/Redis (`docker-compose.test.yml`), seeded by a Playwright `globalSetup`, with the mock rail driving deterministic settlement. Deployment uses one multi-stage `Dockerfile` shared by `web` and `worker`, `railway.json` declaring both services + Postgres/Redis plugins + a `migrate deploy` release command, and a GitHub Actions workflow running the full gate.

**Tech Stack:** Next.js 16.2.x Route Handlers · Prisma 7 · Redis/BullMQ · `@playwright/test` · Vitest (integration) · Docker (multi-stage, pnpm frozen lockfile) · Railway (`railway.json`) · GitHub Actions.

**Depends on: Phases 1–8** (all shared contracts, all UI surfaces, the payment state machine, the BullMQ worker, the `rail`/`storage`/`walletService` services, and `proxy.ts`).

**Deliverable:** PDAX webhook + presign endpoints, a passing Playwright e2e suite (payer happy path, merchant go-live, admin retry/refund), finalized `.env.example`, `Dockerfile`/`.dockerignore`/`railway.json`/CI workflow, and a verified quality-gate checklist.

## Global Constraints

Every task's requirements implicitly include this section (verbatim from `SPEC.md` / `AGENT.md` / overview).

- **Latest stable deps**; `pnpm audit --prod` clean; lockfile committed; `packageManager` pinned; no untrusted `postinstall`.
- **Node.js 22 LTS.** **TypeScript `strict: true`**, no `any` at boundaries; **Zod** parses every Route Handler input (treat all external/webhook input as untrusted).
- **Money is `Decimal` only** (`decimal.js`); XLM 7dp, PHP 2dp; never floats.
- **Secrets never reach client/logs/git/browser**; `.env.example` holds placeholders only; never log secrets, full account numbers, session tokens, wallet secrets.
- **Idempotency on every money-moving + webhook event** (`IdempotencyKey` table; worker jobs keyed `paymentId:status`); all external side effects retry-safe.
- **Consistent error envelope** `{ "error": { "code": string, "message": string, "details"?: unknown } }`; proper HTTP status codes; never leak stack traces/SQL/provider internals.
- **AuthZ default-deny**; webhook is the one unauthenticated POST and MUST instead verify signature + source-IP allowlist.
- **External calls** wrapped with timeout + retry (backoff + jitter) + circuit breaker; validate all responses.
- **Default dev/CI config:** `PAYMENT_RAIL=mock`, `STELLAR_NETWORK=testnet` — full happy path runs with no real money / no PDAX prod creds.
- **Migrations:** `prisma migrate deploy` on release; never `db push` in prod; always set `SHADOW_DATABASE_URL`.
- **Commits:** Conventional Commits, small and focused.

---

## File Structure Map (this phase)

```
heypay/
├─ src/app/api/
│  ├─ health/route.ts                  # NEW public health check (Railway + Playwright readiness)
│  ├─ webhooks/pdax/route.ts           # NEW PDAX trade/cash-out callbacks
│  └─ uploads/presign/route.ts         # NEW presigned upload + post-upload verify
├─ tests/e2e/
│  ├─ global-setup.ts                  # migrate deploy + seed throwaway DB
│  ├─ fixtures.ts                      # QRPH vector, helpers (signup, friendbot, ensureMerchant)
│  ├─ payer-happy-path.spec.ts         # signup→prefund→scan→quote→confirm→SETTLED
│  ├─ merchant-go-live.spec.ts         # onboarding→go-live→settlement visible
│  └─ admin-retry-refund.spec.ts       # admin login→view→force fail→retry/refund
├─ tests/integration/
│  ├─ webhooks-pdax.test.ts            # signature/idempotency/routing
│  └─ uploads-presign.test.ts          # validation + verify
├─ playwright.config.ts                # NEW (boots web+worker, mock rail, testnet)
├─ docker-compose.test.yml             # NEW throwaway postgres+redis (ports 5433/6380)
├─ .env.example                        # FINALIZED authoritative list
├─ Dockerfile                          # NEW multi-stage, shared by web+worker
├─ .dockerignore                       # NEW
├─ railway.json                        # NEW web + worker services
├─ .github/workflows/ci.yml            # NEW full quality gate
└─ package.json                        # MODIFY: add e2e:serve / test:e2e scripts
```

---

## Task 1: Public health endpoint

**Files:**

- Create: `src/app/api/health/route.ts`
- Test: `tests/integration/health.test.ts`

**Interfaces:**

- Consumes: `prisma` (`@/server/db`), `redis` (`@/server/redis`) — singletons from Phase 1.
- Produces: `GET /api/health` → `200 {status:"ok",checks:{db,redis}}` when both reachable, else `503 {status:"degraded",...}`. Consumed by `playwright.config.ts` (Task 6) readiness and `railway.json` (Task 9) health check.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/health.test.ts
import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns ok with db+redis checks when infra is up", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.checks).toEqual({ db: true, redis: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/health.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/health/route'`.

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/health/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { redis } from "@/server/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const checks = { db: false, redis: false };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch {
    // health probe: swallow, report degraded
  }
  try {
    await redis.ping();
    checks.redis = true;
  } catch {
    // health probe: swallow, report degraded
  }
  const ok = checks.db && checks.redis;
  return NextResponse.json({ status: ok ? "ok" : "degraded", checks }, { status: ok ? 200 : 503 });
}
```

- [ ] **Step 4: Run test (requires `docker compose up -d`) to verify it passes**

Run: `docker compose up -d && pnpm vitest run tests/integration/health.test.ts`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/health/route.ts tests/integration/health.test.ts
git commit -m "feat(api): add public /api/health endpoint for Railway + e2e readiness"
```

---

## Task 2: PDAX webhook handler (`POST /api/webhooks/pdax`)

**Files:**

- Create: `src/app/api/webhooks/pdax/route.ts`
- Test: `tests/integration/webhooks-pdax.test.ts`

**Interfaces:**

- Consumes:
  - `prisma` (`@/server/db`) — `payment`, `idempotencyKey` models (SPEC §4).
  - `dec` (`@/lib/money`).
  - From Phase 5 `src/server/payments/state-machine.ts` (add to its `Produces` block if not already present): an idempotent advancer the webhook calls to push a payment forward from an external rail callback:
    ```typescript
    import { Decimal } from "@/lib/money";
    import { PaymentStatus } from "@/generated/prisma";
    export function advanceOnRailCallback(input: {
      paymentId: string;
      kind: "trade" | "cashout";
      externalRef: string; // pdaxTradeRef | pdaxCashoutRef
      state: "PENDING" | "FILLED" | "SETTLED" | "FAILED";
      feePhp?: Decimal;
      netPhp?: Decimal;
    }): Promise<{ status: PaymentStatus }>;
    ```
    It records a `PaymentEvent`, persists trade/cashout refs + fees, and (for `FILLED`/`SETTLED`) advances the state machine or, for resumability, calls `enqueueSettle(paymentId)`. It is idempotent: replaying the same callback is a no-op.
- Produces: `POST /api/webhooks/pdax` — verifies HMAC signature (`X-PDAX-Signature`, sha256 of raw body with `PDAX_WEBHOOK_SECRET`) **and** optional source-IP allowlist (`PDAX_WEBHOOK_IP_ALLOWLIST`), Zod-validates the payload, is idempotent by `eventId` (via `IdempotencyKey` scope `webhook.pdax`), and advances the matched payment. Returns `200 {ok:true}` on success, `401` on bad signature/IP, `400` on malformed body, `200 {ok:true,unmatched:true}` for an unknown ref (so PDAX stops retrying). **No session/CSRF** (server-to-server); reads the **raw** body for signature verification.

**Design notes (Global Constraint: webhook security):**

- The handler does **not** use the `route()` wrapper (which enforces CSRF/session); it is the deliberate exception and substitutes signature + allowlist checks.
- Falls back to worker polling: if PDAX never calls the webhook, the Phase 5 worker still advances the payment by polling `getTradeStatus`/`getPayoutStatus`. The webhook is an accelerator, not the only path — hence it routes through the same idempotent advancer.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/webhooks-pdax.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import { NextRequest } from "next/server";

const advanceOnRailCallback = vi.fn(async () => ({ status: "PDAX_TRADED" }));
vi.mock("@/server/payments/state-machine", () => ({ advanceOnRailCallback }));

const idem = { findUnique: vi.fn(), create: vi.fn(async () => ({})) };
const payment = { findFirst: vi.fn() };
vi.mock("@/server/db", () => ({ prisma: { idempotencyKey: idem, payment } }));

import { POST } from "@/app/api/webhooks/pdax/route";

const SECRET = "test-webhook-secret";
process.env.PDAX_WEBHOOK_SECRET = SECRET;
delete process.env.PDAX_WEBHOOK_IP_ALLOWLIST;

function sign(body: string): string {
  return crypto.createHmac("sha256", SECRET).update(body).digest("hex");
}
function makeReq(body: string, sig: string | null): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (sig !== null) headers.set("x-pdax-signature", sig);
  return new NextRequest("http://localhost/api/webhooks/pdax", { method: "POST", body, headers });
}
const validBody = JSON.stringify({
  eventId: "evt_1",
  type: "trade.updated",
  reference: "TRADE-REF-1",
  status: "FILLED",
  feePhp: "12.50",
});

describe("POST /api/webhooks/pdax", () => {
  beforeEach(() => {
    advanceOnRailCallback.mockClear();
    idem.findUnique.mockReset().mockResolvedValue(null);
    idem.create.mockReset().mockResolvedValue({});
    payment.findFirst.mockReset().mockResolvedValue({ id: "pay_1", pdaxTradeRef: "TRADE-REF-1" });
  });

  it("accepts a valid signed callback and advances the payment", async () => {
    const res = await POST(makeReq(validBody, sign(validBody)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(advanceOnRailCallback).toHaveBeenCalledTimes(1);
    expect(advanceOnRailCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: "pay_1",
        kind: "trade",
        externalRef: "TRADE-REF-1",
        state: "FILLED",
      }),
    );
    expect(idem.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a bad signature with 401 and does not advance", async () => {
    const res = await POST(makeReq(validBody, "deadbeef"));
    expect(res.status).toBe(401);
    expect(advanceOnRailCallback).not.toHaveBeenCalled();
  });

  it("rejects a missing signature with 401", async () => {
    const res = await POST(makeReq(validBody, null));
    expect(res.status).toBe(401);
  });

  it("is idempotent on replay (same eventId)", async () => {
    idem.findUnique.mockResolvedValueOnce({ key: "webhook.pdax:evt_1" });
    const res = await POST(makeReq(validBody, sign(validBody)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, idempotent: true });
    expect(advanceOnRailCallback).not.toHaveBeenCalled();
  });

  it("400s a malformed (but correctly signed) body", async () => {
    const bad = JSON.stringify({ nope: true });
    const res = await POST(makeReq(bad, sign(bad)));
    expect(res.status).toBe(400);
  });

  it("acks unmatched refs with 200 unmatched and records the key", async () => {
    payment.findFirst.mockResolvedValueOnce(null);
    const res = await POST(makeReq(validBody, sign(validBody)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, unmatched: true });
    expect(advanceOnRailCallback).not.toHaveBeenCalled();
    expect(idem.create).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/webhooks-pdax.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/webhooks/pdax/route'`.

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/webhooks/pdax/route.ts
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/server/db";
import { dec } from "@/lib/money";
import { advanceOnRailCallback } from "@/server/payments/state-machine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  eventId: z.string().min(1),
  type: z.enum(["trade.updated", "cashout.updated"]),
  reference: z.string().min(1),
  status: z.enum(["PENDING", "FILLED", "SETTLED", "FAILED"]),
  feePhp: z.string().optional(),
  netPhp: z.string().optional(),
});

const INVALID = NextResponse.json(
  { error: { code: "WEBHOOK_INVALID", message: "Invalid webhook signature or source" } },
  { status: 401 },
);

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.PDAX_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return constantTimeEqual(signature, expected);
}

function ipAllowed(req: NextRequest): boolean {
  const allow = (process.env.PDAX_WEBHOOK_IP_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length === 0) return true; // optional layer; signature is the primary control
  const clientIp = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return clientIp.length > 0 && allow.includes(clientIp);
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  if (!verifySignature(rawBody, req.headers.get("x-pdax-signature")) || !ipAllowed(req)) {
    return INVALID;
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json(
      { error: { code: "WEBHOOK_BAD_BODY", message: "Malformed webhook payload" } },
      { status: 400 },
    );
  }

  const idemKey = `webhook.pdax:${parsed.eventId}`;
  const already = await prisma.idempotencyKey.findUnique({ where: { key: idemKey } });
  if (already) return NextResponse.json({ ok: true, idempotent: true });

  const isTrade = parsed.type === "trade.updated";
  const payment = await prisma.payment.findFirst({
    where: isTrade ? { pdaxTradeRef: parsed.reference } : { pdaxCashoutRef: parsed.reference },
    select: { id: true },
  });

  const expiresAt = new Date(Date.now() + RETENTION_MS);
  if (!payment) {
    await prisma.idempotencyKey.create({
      data: { key: idemKey, scope: "webhook.pdax", expiresAt },
    });
    return NextResponse.json({ ok: true, unmatched: true });
  }

  await advanceOnRailCallback({
    paymentId: payment.id,
    kind: isTrade ? "trade" : "cashout",
    externalRef: parsed.reference,
    state: parsed.status,
    feePhp: parsed.feePhp ? dec(parsed.feePhp) : undefined,
    netPhp: parsed.netPhp ? dec(parsed.netPhp) : undefined,
  });

  await prisma.idempotencyKey.create({ data: { key: idemKey, scope: "webhook.pdax", expiresAt } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/webhooks-pdax.test.ts`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/pdax/route.ts tests/integration/webhooks-pdax.test.ts
git commit -m "feat(api): add idempotent PDAX webhook with HMAC + IP allowlist verification"
```

---

## Task 3: Presigned upload endpoint (`POST /api/uploads/presign`)

**Files:**

- Create: `src/app/api/uploads/presign/route.ts`
- Test: `tests/integration/uploads-presign.test.ts`

**Interfaces:**

- Consumes:
  - `route`, `json`, `parseBody` (`@/lib/http`); `requireUser` (`@/server/auth/sessions`); `badRequest` (`@/lib/errors`).
  - `presignUpload`, `verifyUploadedObject` (`@/server/storage/s3`) — Phase 3 contract:
    ```typescript
    presignUpload(input: { prefix: "qrph" | "logo"; contentType: string; maxBytes: number }): Promise<{ url: string; fields: Record<string,string>; key: string }>;
    verifyUploadedObject(key: string): Promise<void>; // throws badRequest on magic-byte/size mismatch
    ```
- Produces: `POST /api/uploads/presign`. Discriminated body:
  - `{action:"presign", prefix, contentType, sizeBytes}` → validates content-type allowlist + size cap (5 MiB) server-side, returns `{url, fields, key}`.
  - `{action:"verify", key}` → re-validates the uploaded object via `verifyUploadedObject`, returns `{ok:true}`.
    Requires a valid session (any role). 401 unauthenticated, 400 on bad content-type/oversize/unknown action.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/uploads-presign.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const requireUser = vi.fn();
vi.mock("@/server/auth/sessions", () => ({ requireUser }));

const presignUpload = vi.fn(async () => ({
  url: "http://localhost:9000/heypay-uploads",
  fields: { key: "qrph/abc.png", policy: "x" },
  key: "qrph/abc.png",
}));
const verifyUploadedObject = vi.fn(async () => undefined);
vi.mock("@/server/storage/s3", () => ({ presignUpload, verifyUploadedObject }));

import { POST } from "@/app/api/uploads/presign/route";

function makeReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/uploads/presign", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
    },
  });
}
const ctx = { params: Promise.resolve({}) };

describe("POST /api/uploads/presign", () => {
  beforeEach(() => {
    requireUser
      .mockReset()
      .mockResolvedValue({ id: "u1", username: "u", role: "MERCHANT", isActive: true });
    presignUpload.mockClear();
    verifyUploadedObject.mockClear();
  });

  it("returns a presigned POST for a valid image request", async () => {
    const res = await POST(
      makeReq({ action: "presign", prefix: "qrph", contentType: "image/png", sizeBytes: 1024 }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ key: "qrph/abc.png", url: expect.any(String) });
    expect(presignUpload).toHaveBeenCalledWith({
      prefix: "qrph",
      contentType: "image/png",
      maxBytes: 5 * 1024 * 1024,
    });
  });

  it("rejects a disallowed content type with 400", async () => {
    const res = await POST(
      makeReq({
        action: "presign",
        prefix: "qrph",
        contentType: "application/pdf",
        sizeBytes: 1024,
      }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect(presignUpload).not.toHaveBeenCalled();
  });

  it("rejects an oversize request with 400", async () => {
    const res = await POST(
      makeReq({
        action: "presign",
        prefix: "logo",
        contentType: "image/jpeg",
        sizeBytes: 6 * 1024 * 1024,
      }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it("verifies an uploaded object", async () => {
    const res = await POST(makeReq({ action: "verify", key: "qrph/abc.png" }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(verifyUploadedObject).toHaveBeenCalledWith("qrph/abc.png");
  });

  it("401s when unauthenticated", async () => {
    requireUser.mockRejectedValueOnce(
      Object.assign(new Error("unauthorized"), { code: "UNAUTHORIZED", status: 401 }),
    );
    const res = await POST(makeReq({ action: "verify", key: "qrph/abc.png" }), ctx);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/uploads-presign.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/uploads/presign/route'`.

- [ ] **Step 3: Implement the route**

```typescript
// src/app/api/uploads/presign/route.ts
import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { requireUser } from "@/server/auth/sessions";
import { presignUpload, verifyUploadedObject } from "@/server/storage/s3";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MiB
const CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

const BodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("presign"),
    prefix: z.enum(["qrph", "logo"]),
    contentType: z.enum(CONTENT_TYPES),
    sizeBytes: z.number().int().positive().max(MAX_BYTES),
  }),
  z.object({
    action: z.literal("verify"),
    key: z.string().min(1).max(256),
  }),
]);

export const POST = route(async (req) => {
  await requireUser();
  const body = await parseBody(req, BodySchema);

  if (body.action === "presign") {
    const result = await presignUpload({
      prefix: body.prefix,
      contentType: body.contentType,
      maxBytes: MAX_BYTES,
    });
    return json(result);
  }

  await verifyUploadedObject(body.key);
  return json({ ok: true });
});
```

> Note: `route()` (Phase 1) catches `AppError`/`ZodError` → error envelope + status, runs `assertSameOrigin` for unsafe methods, and supplies the `(req, {params})` adapter; `parseBody` throws `badRequest` on Zod failure; `requireUser` throws `unauthorized()` → 401.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/uploads-presign.test.ts`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/uploads/presign/route.ts tests/integration/uploads-presign.test.ts
git commit -m "feat(api): add presigned upload endpoint with content-type/size + post-upload verify"
```

---

## Task 4: Finalize `.env.example` (authoritative list)

**Files:**

- Modify (overwrite): `.env.example`

**Interfaces:**

- Produces: the single authoritative env list. Extends AGENT §10 with the Phase 9 additions: `PORT`, `LOG_LEVEL`, optional `SENTRY_DSN`, the webhook secrets (`PDAX_WEBHOOK_SECRET`, `PDAX_WEBHOOK_IP_ALLOWLIST`), `S3_PUBLIC_URL` (signed-GET base), and the e2e overrides (`E2E_PORT`, `E2E_DATABASE_URL`, `E2E_REDIS_URL`). Every env name referenced by Phases 1–9 appears here with a placeholder.

- [ ] **Step 1: Write the file (complete contents)**

```dotenv
# .env.example — placeholders only; never commit real values.
# Copy to .env and fill in. Authoritative list for HeyPay (all phases).

# --- App ---
NODE_ENV=development
APP_URL=http://localhost:3000
PORT=3000
LOG_LEVEL=info
SESSION_SECRET=replace-with-long-random-string
ENCRYPTION_MASTER_KEY=base64:replace-with-32-byte-key   # AES-256-GCM master key
ENCRYPTION_KEY_VERSION=1

# --- Database (Postgres) ---
# Web service on Railway should use the POOLED connection string.
DATABASE_URL=postgresql://heypay:heypay@localhost:5432/heypay?schema=public
SHADOW_DATABASE_URL=postgresql://heypay:heypay@localhost:5432/heypay_shadow?schema=public

# --- Redis / queue ---
REDIS_URL=redis://localhost:6379

# --- Seeded admin ---
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-me-strong
SEED_DEMO=true

# --- Stellar ---
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# --- Payment rail ---
PAYMENT_RAIL=mock                     # mock | pdax
PDAX_BASE_URL=https://services-stage.pdax.ph/api/exchange/v1
PDAX_ACCESS_KEY=
PDAX_SECRET=
PDAX_TOTP_SECRET=
PDAX_XLM_DEPOSIT_ADDRESS=             # HeyPay's PDAX XLM deposit address (mainnet)

# --- PDAX webhook (server-to-server callbacks) ---
PDAX_WEBHOOK_SECRET=                  # HMAC-SHA256 shared secret for X-PDAX-Signature
PDAX_WEBHOOK_IP_ALLOWLIST=            # optional CSV of allowed source IPs (empty = signature only)

# --- Object storage (MinIO dev / Railway prod, S3-compatible) ---
S3_ENDPOINT=http://localhost:9000
S3_PUBLIC_URL=http://localhost:9000   # base for signed GET URLs (prod: bucket/CDN URL)
S3_REGION=us-east-1
S3_BUCKET=heypay-uploads
S3_ACCESS_KEY=heypay
S3_SECRET_KEY=heypay-secret
S3_FORCE_PATH_STYLE=true              # true for MinIO; false for a real S3 endpoint

# --- Observability (optional) ---
SENTRY_DSN=

# --- E2E test overrides (used by playwright.config.ts; defaults shown) ---
E2E_PORT=3100
E2E_DATABASE_URL=postgresql://heypay:heypay@localhost:5433/heypay_e2e?schema=public
E2E_REDIS_URL=redis://localhost:6380
```

- [ ] **Step 2: Verify every name is unique and complete**

Run: `grep -E '^[A-Z0-9_]+=' .env.example | sed 's/=.*//' | sort | uniq -d`
Expected: (empty output — no duplicate keys).

Run: `grep -cE '^[A-Z0-9_]+=' .env.example`
Expected: `38`

- [ ] **Step 3: Cross-check against code references (no missing key)**

Run: `comm -23 <(grep -rhoE 'process\.env\.[A-Z0-9_]+' src tests | sed 's/process\.env\.//' | sort -u) <(grep -E '^[A-Z0-9_]+=' .env.example | sed 's/=.*//' | sort -u)`
Expected: (empty output — every `process.env.X` used in `src`/`tests` is declared in `.env.example`).

- [ ] **Step 4: Confirm no real secrets committed**

Run: `grep -nE '=(.+)' .env.example | grep -viE '=(replace|http|postgresql|redis|mock|testnet|true|false|info|admin|heypay|us-east-1|Test SDF|1|3000|3100|5433|6380|heypay-secret|heypay-uploads)' || echo "OK: placeholders only"`
Expected: `OK: placeholders only`

- [ ] **Step 5: Commit**

```bash
git add .env.example
git commit -m "chore(env): finalize authoritative .env.example with webhook + e2e vars"
```

---

## Task 5: e2e infrastructure — throwaway services, Playwright config, global setup, fixtures

**Files:**

- Create: `docker-compose.test.yml`
- Create: `playwright.config.ts`
- Create: `tests/e2e/global-setup.ts`
- Create: `tests/e2e/fixtures.ts`
- Modify: `package.json` (scripts)

**Interfaces:**

- Consumes: `/api/health` (Task 1) for webServer readiness; `pnpm prisma migrate deploy` + `pnpm prisma db seed` (Phases 1); the `web` (`pnpm start`) + `worker` (`pnpm worker:start`) entrypoints.
- Produces:
  - `playwright.config.ts` booting the production build of web + worker against `E2E_DATABASE_URL`/`E2E_REDIS_URL` with `PAYMENT_RAIL=mock`, `STELLAR_NETWORK=testnet`.
  - `tests/e2e/fixtures.ts` exporting `DEMO_QRPH_RAW`, `DEMO_QRPH_MERCHANT_NAME`, `uniqueUser()`, `signup()`, `login()`, `fundWithFriendbot()`, `ensureActiveMerchant()` used by Tasks 6–8.

> The QRPH vector below is a real EMVCo string with a valid CRC-16/CCITT-FALSE (verified: payload through `6304` → CRC `2556`). Static QR (tag 01 = 11), PHP currency (tag 53 = 608), merchant id `HEYPAYDEMO0001`.

- [ ] **Step 1: Create the throwaway compose file**

```yaml
# docker-compose.test.yml — ephemeral Postgres + Redis for e2e (distinct ports; no volumes)
services:
  postgres-e2e:
    image: postgres:17
    environment:
      POSTGRES_USER: heypay
      POSTGRES_PASSWORD: heypay
      POSTGRES_DB: heypay_e2e
    ports: ["5433:5432"]
    tmpfs: ["/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U heypay -d heypay_e2e"]
      interval: 2s
      timeout: 3s
      retries: 30
  redis-e2e:
    image: redis:7
    ports: ["6380:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      timeout: 3s
      retries: 30
```

- [ ] **Step 2: Add scripts to `package.json`**

Add these entries to the `"scripts"` object (keep existing scripts):

```json
{
  "scripts": {
    "e2e:serve": "concurrently -k -n web,worker -c blue,magenta \"pnpm start -p ${E2E_PORT:-3100}\" \"pnpm worker:start\"",
    "test:e2e": "playwright test",
    "test:e2e:up": "docker compose -f docker-compose.test.yml up -d --wait",
    "test:e2e:down": "docker compose -f docker-compose.test.yml down -v"
  }
}
```

Install the dev dependency the script needs:

Run: `pnpm add -D concurrently@latest`
Expected: lockfile updated; `concurrently` appears under `devDependencies`.

- [ ] **Step 3: Create the global setup**

```typescript
// tests/e2e/global-setup.ts
import { execSync } from "node:child_process";

const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgresql://heypay:heypay@localhost:5433/heypay_e2e?schema=public";

export default async function globalSetup(): Promise<void> {
  const env = {
    ...process.env,
    DATABASE_URL: E2E_DATABASE_URL,
    SHADOW_DATABASE_URL: E2E_DATABASE_URL.replace("heypay_e2e", "heypay_e2e_shadow"),
    SEED_DEMO: "false", // tests create their own deterministic fixtures
    ADMIN_USERNAME: process.env.ADMIN_USERNAME ?? "admin",
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "admin-e2e-pass",
  };
  execSync("pnpm prisma migrate deploy", { stdio: "inherit", env });
  execSync("pnpm prisma db seed", { stdio: "inherit", env }); // seeds the admin
}
```

- [ ] **Step 4: Create the Playwright config**

```typescript
// playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "3100";
const BASE_URL = `http://localhost:${PORT}`;
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgresql://heypay:heypay@localhost:5433/heypay_e2e?schema=public";
const E2E_REDIS_URL = process.env.E2E_REDIS_URL ?? "redis://localhost:6380";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm e2e:serve",
    url: `${BASE_URL}/api/health`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NODE_ENV: "production",
      PORT,
      E2E_PORT: PORT,
      APP_URL: BASE_URL,
      PAYMENT_RAIL: "mock",
      STELLAR_NETWORK: "testnet",
      STELLAR_HORIZON_URL: "https://horizon-testnet.stellar.org",
      STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
      DATABASE_URL: E2E_DATABASE_URL,
      SHADOW_DATABASE_URL: E2E_DATABASE_URL.replace("heypay_e2e", "heypay_e2e_shadow"),
      REDIS_URL: E2E_REDIS_URL,
      SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-session-secret-not-for-prod-0123456789",
      ENCRYPTION_MASTER_KEY:
        process.env.ENCRYPTION_MASTER_KEY ?? "base64:MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=",
      ENCRYPTION_KEY_VERSION: "1",
      ADMIN_USERNAME: process.env.ADMIN_USERNAME ?? "admin",
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "admin-e2e-pass",
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:9000",
      S3_PUBLIC_URL: process.env.S3_PUBLIC_URL ?? "http://localhost:9000",
      S3_REGION: "us-east-1",
      S3_BUCKET: process.env.S3_BUCKET ?? "heypay-uploads",
      S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? "heypay",
      S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? "heypay-secret",
      S3_FORCE_PATH_STYLE: "true",
    },
  },
});
```

- [ ] **Step 5: Create shared fixtures**

```typescript
// tests/e2e/fixtures.ts
import { APIRequestContext, expect, Page } from "@playwright/test";

// Real EMVCo QRPH, CRC-16/CCITT-FALSE valid. Static (tag 01=11), PHP (53=608), merchant id HEYPAYDEMO0001.
export const DEMO_QRPH_RAW =
  "00020101021126330011ph.ppmi.p2m0114HEYPAYDEMO00015204581453036085802PH5920HEYPAY DEMO MERCHANT6006MANILA63042556";
export const DEMO_QRPH_MERCHANT_NAME = "HEYPAY DEMO MERCHANT";

export function uniqueUser(prefix: string): { username: string; password: string } {
  return {
    username: `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e4)}`,
    password: "Sup3r-Secret-Pw!",
  };
}

export async function signup(
  request: APIRequestContext,
  user: { username: string; password: string },
  role: "PAYER" | "MERCHANT",
): Promise<void> {
  const res = await request.post("/api/auth/signup", { data: { ...user, role } });
  expect(res.ok(), `signup failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

export async function login(
  page: Page,
  user: { username: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/username/i).fill(user.username);
  await page.getByLabel(/password/i).fill(user.password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/(payer|merchant|admin)/);
}

// Fund a testnet account via friendbot (idempotent enough for a fresh account).
export async function fundWithFriendbot(
  request: APIRequestContext,
  publicKey: string,
): Promise<void> {
  const res = await request.get(
    `https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`,
  );
  // 200 = funded now; 400 = already funded — both acceptable.
  expect([200, 400]).toContain(res.status());
}

// Create + onboard + go-live a merchant entirely via the API; returns its id.
export async function ensureActiveMerchant(
  request: APIRequestContext,
): Promise<{ merchantId: string }> {
  const create = await request.post("/api/merchant", {
    data: { businessName: DEMO_QRPH_MERCHANT_NAME },
  });
  expect(create.ok(), `merchant create failed: ${await create.text()}`).toBeTruthy();
  const { merchant } = await create.json();

  const settle = await request.post("/api/merchant/settlement", {
    data: { bankCode: "BPI", accountName: "HeyPay Demo Inc", accountNumber: "1234567890" },
  });
  expect(settle.ok(), `settlement failed: ${await settle.text()}`).toBeTruthy();

  const qr = await request.post("/api/merchant/qrph", { data: { raw: DEMO_QRPH_RAW } });
  expect(qr.ok(), `qrph link failed: ${await qr.text()}`).toBeTruthy();

  const live = await request.post("/api/merchant/go-live", { data: {} });
  expect(live.ok(), `go-live failed: ${await live.text()}`).toBeTruthy();

  return { merchantId: merchant.id };
}
```

- [ ] **Step 6: Verify the harness boots (no specs yet)**

Run: `pnpm test:e2e:up && pnpm playwright install --with-deps chromium`
Expected: `postgres-e2e` + `redis-e2e` healthy; chromium installed.

Run: `pnpm exec playwright test --list`
Expected: prints `Listing tests:` then `Total: 0 tests in 0 files` (config + globalSetup load without error; specs added in Tasks 6–8).

- [ ] **Step 7: Commit**

```bash
git add docker-compose.test.yml playwright.config.ts tests/e2e/global-setup.ts tests/e2e/fixtures.ts package.json pnpm-lock.yaml
git commit -m "test(e2e): add Playwright config, throwaway compose, global setup, and fixtures"
```

---

## Task 6: e2e spec — payer happy path (signup → prefund → scan → quote → confirm → SETTLED)

**Files:**

- Create: `tests/e2e/payer-happy-path.spec.ts`

**Interfaces:**

- Consumes: `tests/e2e/fixtures.ts`; endpoints `/api/auth/signup`, `/api/wallet/deposit-address`, `/api/wallet/sync`, `/api/qrph/decode`, `/api/payments/quote`, `/api/payments/[id]/confirm`, `/api/payments/[id]`; payer UI routes `/payer/scan`, `/payer/pay/[paymentId]/confirm`. The worker (mock rail) drives the payment to `SETTLED`.

> The spec drives the real flow through the API where the UI would just be a thin shell (signup, prefund, quote) and through the UI for the headline confirm screen, then polls `GET /api/payments/[id]` until `SETTLED`. With `PAYMENT_RAIL=mock` the worker settles deterministically.

- [ ] **Step 1: Write the spec (complete)**

```typescript
// tests/e2e/payer-happy-path.spec.ts
import { test, expect, request as playwrightRequest } from "@playwright/test";
import {
  DEMO_QRPH_RAW,
  DEMO_QRPH_MERCHANT_NAME,
  uniqueUser,
  signup,
  login,
  fundWithFriendbot,
  ensureActiveMerchant,
} from "./fixtures";

test("payer pays a QRPH merchant from XLM balance through to SETTLED", async ({
  page,
  baseURL,
}) => {
  test.slow(); // settlement + friendbot funding take time

  // --- Setup: an ACTIVE merchant exists (own API session, isolated cookies) ---
  const merchantCtx = await playwrightRequest.newContext({ baseURL });
  const merchant = uniqueUser("merch");
  await signup(merchantCtx, merchant, "MERCHANT");
  await ensureActiveMerchant(merchantCtx);
  await merchantCtx.dispose();

  // --- Payer signs up (gets a custodial wallet) ---
  const payer = uniqueUser("payer");
  const payerCtx = await playwrightRequest.newContext({ baseURL });
  await signup(payerCtx, payer, "PAYER");

  // --- Prefund: friendbot-fund the custodial address, then sync ---
  const addrRes = await payerCtx.get("/api/wallet/deposit-address");
  expect(addrRes.ok(), await addrRes.text()).toBeTruthy();
  const { publicKey } = await addrRes.json();
  expect(publicKey).toMatch(/^G[A-Z2-7]{55}$/);
  await fundWithFriendbot(payerCtx, publicKey);

  await expect
    .poll(
      async () => {
        const sync = await payerCtx.post("/api/wallet/sync", { data: {} });
        if (!sync.ok()) return 0;
        const { balanceXlm } = await sync.json();
        return Number(balanceXlm);
      },
      { timeout: 60_000, intervals: [2000] },
    )
    .toBeGreaterThan(100); // friendbot funds 10000 XLM on testnet

  // --- Scan: feed the known raw QRPH to the decode endpoint, expect merchant resolution ---
  const decodeRes = await payerCtx.post("/api/qrph/decode", { data: { raw: DEMO_QRPH_RAW } });
  expect(decodeRes.ok(), await decodeRes.text()).toBeTruthy();
  const decoded = await decodeRes.json();
  expect(decoded.decoded.crcValid).toBe(true);
  expect(decoded.merchant, "QRPH should resolve to a registered merchant").toBeTruthy();
  const merchantId: string = decoded.merchant.id;

  // --- Quote: lock a rate for a PHP amount ---
  const quoteRes = await payerCtx.post("/api/payments/quote", {
    data: { merchantId, amountPhp: "250.00" },
  });
  expect(quoteRes.ok(), await quoteRes.text()).toBeTruthy();
  const quote = await quoteRes.json();
  expect(quote.paymentId).toBeTruthy();
  expect(Number(quote.amountXlm)).toBeGreaterThan(0);
  const paymentId: string = quote.paymentId;

  // --- Confirm via the UI confirm screen (headline flow) ---
  await login(page, payer);
  await page.goto(`/payer/pay/${paymentId}/confirm`);
  await expect(page.getByText(DEMO_QRPH_MERCHANT_NAME)).toBeVisible();
  await expect(page.getByText(/₱\s*250(\.00)?/)).toBeVisible();
  await page.getByRole("button", { name: /confirm/i }).click();

  // Processing overlay appears
  await expect(page.getByText(/processing|sending|settl/i)).toBeVisible();

  // --- Poll the payment until SETTLED (worker + mock rail drive it) ---
  await expect
    .poll(
      async () => {
        const res = await payerCtx.get(`/api/payments/${paymentId}`);
        if (!res.ok()) return "ERR";
        const { payment } = await res.json();
        return payment.status as string;
      },
      { timeout: 90_000, intervals: [2000] },
    )
    .toBe("SETTLED");

  // --- Success screen ---
  await expect(page.getByText(/success|sent|settled|₱\s*250/i)).toBeVisible({ timeout: 30_000 });

  await payerCtx.dispose();
});
```

- [ ] **Step 2: Run the spec — expect initial FAIL until the app is fully wired**

Run: `pnpm test:e2e:up && pnpm playwright test tests/e2e/payer-happy-path.spec.ts`
Expected (before Phases 5–6 wiring is verified end-to-end): FAIL — typically a timeout polling `status === "SETTLED"`, or a missing element on the confirm screen.

- [ ] **Step 3: Drive to PASS**

If a step fails, fix the _application_ wiring it exercises (decode resolution, quote balance check, worker settlement under mock rail, confirm-screen copy) — not the test. Re-run until green.

Run: `pnpm playwright test tests/e2e/payer-happy-path.spec.ts`
Expected: PASS (1 passed).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/payer-happy-path.spec.ts
git commit -m "test(e2e): payer happy path signup→prefund→scan→confirm→SETTLED"
```

---

## Task 7: e2e spec — merchant onboarding → go-live → settlement appears

**Files:**

- Create: `tests/e2e/merchant-go-live.spec.ts`

**Interfaces:**

- Consumes: `tests/e2e/fixtures.ts`; merchant UI routes `/merchant/onboarding`, `/merchant/dashboard`, `/merchant/transactions`; endpoints used by the wizard; the payer-side helpers to generate a real settlement against this merchant.

> Drives the 4-step onboarding wizard through the UI to "Go Live", then makes a payer settle a payment to this merchant (via API for speed) and asserts the settlement is visible in the merchant's business transactions.

- [ ] **Step 1: Write the spec (complete)**

```typescript
// tests/e2e/merchant-go-live.spec.ts
import { test, expect, request as playwrightRequest } from "@playwright/test";
import {
  DEMO_QRPH_RAW,
  DEMO_QRPH_MERCHANT_NAME,
  uniqueUser,
  signup,
  login,
  fundWithFriendbot,
} from "./fixtures";

test("merchant completes onboarding, goes live, and sees a settlement", async ({
  page,
  baseURL,
}) => {
  test.slow();

  // --- Merchant signs up + onboards via the wizard UI ---
  const merchant = uniqueUser("merch");
  const merchantCtx = await playwrightRequest.newContext({ baseURL });
  await signup(merchantCtx, merchant, "MERCHANT");
  await login(page, merchant);

  await page.goto("/merchant/onboarding");

  // Step 1 — Business identity
  await page.getByLabel(/business name/i).fill(DEMO_QRPH_MERCHANT_NAME);
  await page.getByRole("button", { name: /next|continue/i }).click();

  // Step 2 — Settlement account
  await page.getByRole("radio", { name: /BPI/i }).click();
  await page.getByLabel(/account name/i).fill("HeyPay Demo Inc");
  await page.getByLabel(/account number/i).fill("1234567890");
  await page.getByRole("button", { name: /next|continue/i }).click();

  // Step 3 — Link QRPH (paste raw)
  await page.getByLabel(/qr|raw|paste/i).fill(DEMO_QRPH_RAW);
  await page.getByRole("button", { name: /decode|link|next|continue/i }).click();
  await expect(page.getByText(DEMO_QRPH_MERCHANT_NAME)).toBeVisible();

  // Step 4 — Review → Go Live
  await page.getByRole("button", { name: /go live/i }).click();

  // Dashboard reflects ACTIVE status
  await page.waitForURL(/\/merchant\/dashboard/);
  await expect(page.getByText(/active|live/i)).toBeVisible();

  // Confirm ACTIVE via API
  const me = await merchantCtx.get("/api/merchant/me");
  expect(me.ok(), await me.text()).toBeTruthy();
  const { merchant: merchantRecord } = await me.json();
  expect(merchantRecord.status).toBe("ACTIVE");
  const merchantId: string = merchantRecord.id;

  // --- A payer settles a payment to this merchant (API for speed) ---
  const payer = uniqueUser("payer");
  const payerCtx = await playwrightRequest.newContext({ baseURL });
  await signup(payerCtx, payer, "PAYER");
  const addr = await payerCtx.get("/api/wallet/deposit-address");
  const { publicKey } = await addr.json();
  await fundWithFriendbot(payerCtx, publicKey);
  await expect
    .poll(
      async () => {
        const s = await payerCtx.post("/api/wallet/sync", { data: {} });
        return s.ok() ? Number((await s.json()).balanceXlm) : 0;
      },
      { timeout: 60_000, intervals: [2000] },
    )
    .toBeGreaterThan(100);

  const quoteRes = await payerCtx.post("/api/payments/quote", {
    data: { merchantId, amountPhp: "175.00" },
  });
  expect(quoteRes.ok(), await quoteRes.text()).toBeTruthy();
  const { paymentId } = await quoteRes.json();
  const confirmRes = await payerCtx.post(`/api/payments/${paymentId}/confirm`, {
    data: {},
    headers: { "Idempotency-Key": `e2e-${paymentId}` },
  });
  expect(confirmRes.ok(), await confirmRes.text()).toBeTruthy();

  await expect
    .poll(
      async () => {
        const r = await payerCtx.get(`/api/payments/${paymentId}`);
        return r.ok() ? (await r.json()).payment.status : "ERR";
      },
      { timeout: 90_000, intervals: [2000] },
    )
    .toBe("SETTLED");

  // --- Settlement appears in the merchant's business transactions ---
  await page.goto("/merchant/transactions");
  await expect(page.getByText(/₱\s*175(\.00)?/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/settled/i)).toBeVisible();

  await merchantCtx.dispose();
  await payerCtx.dispose();
});
```

- [ ] **Step 2: Run the spec — expect initial FAIL until wired**

Run: `pnpm playwright test tests/e2e/merchant-go-live.spec.ts`
Expected: FAIL initially (wizard labels/buttons or transactions table copy not yet matching), or a settlement-poll timeout.

- [ ] **Step 3: Drive to PASS** (fix app wiring exercised by the wizard / transactions list; do not weaken the assertions).

Run: `pnpm playwright test tests/e2e/merchant-go-live.spec.ts`
Expected: PASS (1 passed).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/merchant-go-live.spec.ts
git commit -m "test(e2e): merchant onboarding→go-live→settlement visible"
```

---

## Task 8: e2e spec — admin login → view payments → force MockProvider failure → retry/refund

**Files:**

- Create: `tests/e2e/admin-retry-refund.spec.ts`

**Interfaces:**

- Consumes: `tests/e2e/fixtures.ts`; admin login (seeded `ADMIN_USERNAME`/`ADMIN_PASSWORD`); admin routes `/admin/payments`; endpoints `POST /api/admin/payments/[id]/retry`, `POST /api/admin/payments/[id]/refund`; the MockProvider forced-failure switch from Phase 4.
- The MockProvider exposes a deterministic failure trigger driven by the quote amount: a magic PHP amount (`66.66`) makes `getTradeStatus`/`getPayoutStatus` return `FAILED`, sending the payment to `FAILED`/`REFUND_PENDING`. (Phase 4 `MockProvider` Produces this: "forced-failure switch"; this spec depends on amount `66.66` triggering it. If Phase 4 used a different trigger, update this constant to match.)

- [ ] **Step 1: Write the spec (complete)**

```typescript
// tests/e2e/admin-retry-refund.spec.ts
import { test, expect, request as playwrightRequest } from "@playwright/test";
import { uniqueUser, signup, login, fundWithFriendbot, ensureActiveMerchant } from "./fixtures";

const FORCE_FAIL_PHP = "66.66"; // MockProvider forced-failure trigger amount (Phase 4)
const ADMIN = {
  username: process.env.ADMIN_USERNAME ?? "admin",
  password: process.env.ADMIN_PASSWORD ?? "admin-e2e-pass",
};

test("admin views a failed payment and refunds it", async ({ page, baseURL }) => {
  test.slow();

  // --- Setup: merchant + funded payer; create a payment that the mock rail will FAIL ---
  const merchantCtx = await playwrightRequest.newContext({ baseURL });
  const merchant = uniqueUser("merch");
  await signup(merchantCtx, merchant, "MERCHANT");
  const { merchantId } = await ensureActiveMerchant(merchantCtx);
  await merchantCtx.dispose();

  const payer = uniqueUser("payer");
  const payerCtx = await playwrightRequest.newContext({ baseURL });
  await signup(payerCtx, payer, "PAYER");
  const addr = await payerCtx.get("/api/wallet/deposit-address");
  const { publicKey } = await addr.json();
  await fundWithFriendbot(payerCtx, publicKey);
  await expect
    .poll(
      async () => {
        const s = await payerCtx.post("/api/wallet/sync", { data: {} });
        return s.ok() ? Number((await s.json()).balanceXlm) : 0;
      },
      { timeout: 60_000, intervals: [2000] },
    )
    .toBeGreaterThan(100);

  const quoteRes = await payerCtx.post("/api/payments/quote", {
    data: { merchantId, amountPhp: FORCE_FAIL_PHP },
  });
  expect(quoteRes.ok(), await quoteRes.text()).toBeTruthy();
  const { paymentId } = await quoteRes.json();
  const confirmRes = await payerCtx.post(`/api/payments/${paymentId}/confirm`, {
    data: {},
    headers: { "Idempotency-Key": `e2e-fail-${paymentId}` },
  });
  expect(confirmRes.ok(), await confirmRes.text()).toBeTruthy();

  // --- Wait until the payment reaches a failure-family terminal/branch state ---
  await expect
    .poll(
      async () => {
        const r = await payerCtx.get(`/api/payments/${paymentId}`);
        return r.ok() ? (await r.json()).payment.status : "ERR";
      },
      { timeout: 90_000, intervals: [2000] },
    )
    .toMatch(/FAILED|REFUND_PENDING/);

  // --- Admin logs in and finds the payment ---
  await login(page, ADMIN);
  await page.goto("/admin/payments");
  const row = page.getByRole("row", { hasText: paymentId.slice(0, 8) }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText(/FAILED|REFUND_PENDING/)).toBeVisible();

  // --- Admin triggers a refund via the admin API (authenticated as admin) ---
  const refundRes = await page.request.post(`/api/admin/payments/${paymentId}/refund`, {
    data: {},
  });
  expect(refundRes.ok(), await refundRes.text()).toBeTruthy();

  // --- Observe the payment reach REFUNDED ---
  await expect
    .poll(
      async () => {
        const r = await page.request.get(`/api/payments/${paymentId}`);
        return r.ok() ? (await r.json()).payment.status : "ERR";
      },
      { timeout: 90_000, intervals: [2000] },
    )
    .toBe("REFUNDED");

  // --- The admin payments view reflects the refund ---
  await page.reload();
  await expect(
    page
      .getByRole("row", { hasText: paymentId.slice(0, 8) })
      .first()
      .getByText(/REFUNDED/),
  ).toBeVisible({ timeout: 15_000 });

  await payerCtx.dispose();
});
```

- [ ] **Step 2: Run the spec — expect initial FAIL until wired**

Run: `pnpm playwright test tests/e2e/admin-retry-refund.spec.ts`
Expected: FAIL initially (forced-failure trigger or admin refund action not yet wired).

- [ ] **Step 3: Drive to PASS** (ensure MockProvider's forced-failure trigger and the admin retry/refund endpoints + payments view are wired; do not weaken assertions).

Run: `pnpm playwright test tests/e2e/admin-retry-refund.spec.ts`
Expected: PASS (1 passed).

- [ ] **Step 4: Run the whole e2e suite, then tear down**

Run: `pnpm playwright test`
Expected: PASS (3 passed).

Run: `pnpm test:e2e:down`
Expected: throwaway containers + volumes removed.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/admin-retry-refund.spec.ts
git commit -m "test(e2e): admin views forced MockProvider failure and refunds"
```

---

## Task 9: Multi-stage Dockerfile + `.dockerignore`

**Files:**

- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces:**

- Consumes: `package.json` scripts `build` (`next build`), `start` (`next start`), `worker:start` (`tsx src/worker/index.ts` or compiled equivalent); Prisma generator output `src/generated/prisma`; `pnpm-lock.yaml`.
- Produces: one image used by both Railway services. Web runs the default `CMD`; the worker service overrides the start command to `pnpm worker:start`. Non-root runtime; pnpm via corepack; `prisma generate` at build time; frozen lockfile.

> Next.js `output: "standalone"` keeps the runtime image small. Confirm `next.config.ts` sets `output: "standalone"` (add it in Phase 1 config if missing). The worker needs `node_modules` + Prisma client + compiled/`tsx` sources; this multi-stage build ships the standalone server for web and the full app for the worker by copying both the standalone output and the source/`node_modules` needed by `tsx`.

- [ ] **Step 1: Create `.dockerignore`**

```gitignore
# .dockerignore
node_modules
.next
.git
.github
.env
.env.*
!.env.example
npm-debug.log*
pnpm-debug.log*
coverage
playwright-report
test-results
tests/e2e
Dockerfile
.dockerignore
docker-compose*.yml
*.md
.vscode
.idea
```

- [ ] **Step 2: Create the multi-stage `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
# ---- Base: Node 22 + pnpm via corepack ----
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /app

# ---- Dependencies (cached on lockfile) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- Build: generate Prisma client + build Next ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- Runtime: minimal, non-root, runs web (default) or worker (override CMD) ----
FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Full app deps (worker uses tsx + Prisma client at runtime)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/src ./src
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/src/generated ./src/generated

USER nextjs
EXPOSE 3000
ENV PORT=3000
# Web service default; the worker service overrides this with: pnpm worker:start
CMD ["pnpm", "start"]
```

- [ ] **Step 3: Build the image to verify it succeeds**

Run: `docker build -t heypay:ci .`
Expected: build completes; final line `naming to docker.io/library/heypay:ci`. No `prisma generate` or `next build` errors.

- [ ] **Step 4: Verify it runs as non-root**

Run: `docker run --rm heypay:ci id -u`
Expected: `1001` (non-root).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: multi-stage Dockerfile (pnpm frozen, prisma generate, non-root) + dockerignore"
```

---

## Task 10: `railway.json` — web + worker services

**Files:**

- Create: `railway.json`

**Interfaces:**

- Consumes: the `Dockerfile` (Task 9); `/api/health` (Task 1); `pnpm prisma migrate deploy`; scripts `start` and `worker:start`.
- Produces: a Railway config declaring two services (`web`, `worker`) built from the shared Dockerfile, a release command running migrations, a health check on `/api/health` for `web`, and documented Postgres/Redis plugins + env-group + pooled-DB-URL conventions.

> Railway injects `DATABASE_URL`/`REDIS_URL` from the Postgres/Redis plugins. The **web** service must use the **pooled** Postgres URL (set `DATABASE_URL` to the pooled connection string in the web service's variables / shared env group). Both services share an env group containing all `.env.example` keys (with real values). Object storage: a Railway bucket (or volume) → set `S3_*` (`S3_FORCE_PATH_STYLE=false` for a real S3 endpoint).

- [ ] **Step 1: Create `railway.json`**

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "releaseCommand": "pnpm prisma migrate deploy",
    "startCommand": "pnpm start",
    "healthcheckPath": "/api/health",
    "healthcheckTimeout": 120,
    "numReplicas": 1,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  },
  "environments": {
    "production": {
      "web": {
        "deploy": {
          "startCommand": "pnpm start",
          "healthcheckPath": "/api/health"
        }
      },
      "worker": {
        "deploy": {
          "startCommand": "pnpm worker:start",
          "healthcheckPath": null,
          "restartPolicyType": "ALWAYS"
        }
      }
    }
  }
}
```

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('railway.json','utf8')); console.log('railway.json valid')"`
Expected: `railway.json valid`

- [ ] **Step 3: Document the Railway setup (commit message body + repo notes)**

Confirm the following are documented (in the commit body and/or `README`/deploy notes — do not put secrets in git):

- Add **Postgres** and **Redis** plugins → they inject `DATABASE_URL` / `REDIS_URL`.
- Create two services from this repo: `web` (start `pnpm start`) and `worker` (start `pnpm worker:start`); both build from `Dockerfile`.
- Set the **web** service `DATABASE_URL` to the **pooled** connection string.
- Shared **env group** holds every `.env.example` key with real values: `NODE_ENV=production`, `STELLAR_NETWORK=mainnet`, `PAYMENT_RAIL=pdax`, real `PDAX_*`, `PDAX_WEBHOOK_SECRET`, `S3_*` (`S3_FORCE_PATH_STYLE=false`).
- **Release command** `pnpm prisma migrate deploy` runs before traffic shifts.
- **One-off prod admin seed:** run once after first deploy:
  `railway run --service web pnpm prisma db seed`
  (uses `ADMIN_USERNAME`/`ADMIN_PASSWORD` from the env group; idempotent upsert). Force an admin password change on first login.

- [ ] **Step 4: Commit**

```bash
git add railway.json
git commit -m "deploy: railway.json with web+worker services, migrate-deploy release, health check

Setup notes:
- Add Postgres + Redis plugins (inject DATABASE_URL/REDIS_URL).
- web uses the POOLED DATABASE_URL; shared env group holds all .env.example keys.
- Release command runs prisma migrate deploy.
- One-off prod admin seed: railway run --service web pnpm prisma db seed."
```

---

## Task 11: CI workflow (`.github/workflows/ci.yml`)

**Files:**

- Create: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: every quality-gate command — `pnpm install --frozen-lockfile`, `pnpm prisma migrate deploy`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm audit --prod`, `pnpm vitest run`, `pnpm playwright test`; service containers for Postgres + Redis; the `/api/health` readiness used by Playwright.
- Produces: a single `ci` workflow gating PRs/pushes. Runs the mock rail + testnet for e2e.

- [ ] **Step 1: Create the workflow**

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: postgresql://heypay:heypay@localhost:5432/heypay?schema=public
      SHADOW_DATABASE_URL: postgresql://heypay:heypay@localhost:5432/heypay_shadow?schema=public
      E2E_DATABASE_URL: postgresql://heypay:heypay@localhost:5432/heypay_e2e?schema=public
      REDIS_URL: redis://localhost:6379
      E2E_REDIS_URL: redis://localhost:6379
      E2E_PORT: "3100"
      APP_URL: http://localhost:3100
      PAYMENT_RAIL: mock
      STELLAR_NETWORK: testnet
      STELLAR_HORIZON_URL: https://horizon-testnet.stellar.org
      STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015"
      SESSION_SECRET: ci-session-secret-not-for-prod-0123456789abcdef
      ENCRYPTION_MASTER_KEY: "base64:MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA="
      ENCRYPTION_KEY_VERSION: "1"
      ADMIN_USERNAME: admin
      ADMIN_PASSWORD: admin-ci-pass
      S3_ENDPOINT: http://localhost:9000
      S3_PUBLIC_URL: http://localhost:9000
      S3_REGION: us-east-1
      S3_BUCKET: heypay-uploads
      S3_ACCESS_KEY: heypay
      S3_SECRET_KEY: heypay-secret
      S3_FORCE_PATH_STYLE: "true"
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: heypay
          POSTGRES_PASSWORD: heypay
          POSTGRES_DB: heypay
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U heypay" --health-interval 5s
          --health-timeout 5s --health-retries 20
      redis:
        image: redis:7
        ports: ["6379:6379"]
        options: >-
          --health-cmd "redis-cli ping" --health-interval 5s
          --health-timeout 5s --health-retries 20
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install (frozen lockfile)
        run: pnpm install --frozen-lockfile

      - name: Create test databases
        run: |
          PGPASSWORD=heypay psql -h localhost -U heypay -d heypay -c "CREATE DATABASE heypay_shadow;" || true
          PGPASSWORD=heypay psql -h localhost -U heypay -d heypay -c "CREATE DATABASE heypay_e2e;" || true
          PGPASSWORD=heypay psql -h localhost -U heypay -d heypay -c "CREATE DATABASE heypay_e2e_shadow;" || true

      - name: Prisma generate
        run: pnpm prisma generate

      - name: Migrate (test db)
        run: pnpm prisma migrate deploy

      - name: Typecheck
        run: pnpm typecheck

      - name: Lint
        run: pnpm lint

      - name: Format check
        run: pnpm format:check

      - name: Audit (prod deps)
        run: pnpm audit --prod

      - name: Unit + integration tests
        run: pnpm vitest run

      - name: Build
        run: pnpm build

      - name: Install Playwright browsers
        run: pnpm exec playwright install --with-deps chromium

      - name: E2E (mock rail + testnet)
        run: pnpm playwright test

      - name: Upload Playwright report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report
          retention-days: 7
```

- [ ] **Step 2: Validate the workflow YAML**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!/jobs:/.test(y)||!/playwright test/.test(y)) throw new Error('missing gate'); console.log('ci.yml structure OK')"`
Expected: `ci.yml structure OK`

- [ ] **Step 3: Dry-run the gate locally (the commands CI runs)**

Run: `docker compose up -d && pnpm install --frozen-lockfile && pnpm prisma migrate deploy && pnpm typecheck && pnpm lint && pnpm format:check && pnpm audit --prod && pnpm vitest run`
Expected: every command exits 0.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: full quality gate (typecheck/lint/format/audit/vitest/playwright) on PRs"
```

---

## Task 12: Final quality-gate checklist (AGENT §12 + SPEC §12)

**Files:**

- None created. This task runs and records the gate; each item below has the exact command + expected result. Treat any failure as a defect to fix in the owning phase before declaring "done".

**Interfaces:**

- Consumes: everything from Phases 1–9.

- [ ] **Static gates clean** — `pnpm typecheck && pnpm lint && pnpm format:check`
      Expected: all exit 0; no `any` at boundaries.
- [ ] **Dependency hygiene** — `pnpm audit --prod`
      Expected: `No known vulnerabilities found`. Lockfile committed (`git status --porcelain pnpm-lock.yaml` empty); `packageManager` pinned (`grep packageManager package.json`).
- [ ] **Deps current** — `pnpm outdated || true`
      Expected: review output; no known-vulnerable majors left behind.
- [ ] **Unit tests** (QRPH TLV+CRC, quote/fee math, state-machine transitions, envelope encryption round-trip) — `pnpm vitest run tests/unit`
      Expected: all pass.
- [ ] **Integration tests** (API handlers vs throwaway Postgres; webhook; presign; health) — `docker compose up -d && pnpm vitest run tests/integration`
      Expected: all pass.
- [ ] **E2E** (mock rail + testnet: payer happy path; merchant go-live; admin retry/refund) — `pnpm test:e2e:up && pnpm playwright test`
      Expected: 3 passed.
- [ ] **Migrations apply cleanly + seed idempotent** — `pnpm prisma migrate deploy && pnpm prisma db seed && pnpm prisma db seed`
      Expected: migrations applied; admin upserted both runs with no error/duplicate.
- [ ] **Clean-checkout bootstrap works** — follow AGENT §9 from a fresh clone: `pnpm install && docker compose up -d && cp .env.example .env && pnpm prisma migrate dev && pnpm prisma db seed && pnpm dev` (and `pnpm worker:dev`)
      Expected: web boots on :3000, worker consumes queues, no missing-env errors.
- [ ] **Security headers present** — `curl -sI http://localhost:3000/login`
      Expected: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Content-Security-Policy`, and `Permissions-Policy` (camera only on `/payer/scan`).
- [ ] **CSRF + rate limits active** — `curl -s -X POST http://localhost:3000/api/payments/quote -H 'content-type: application/json' -d '{}'` from a foreign origin
      Expected: 403 (origin check) / 401 (no session); repeated `/api/auth/login` attempts → 429.
- [ ] **Webhook security** — `curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/webhooks/pdax -H 'content-type: application/json' -d '{"eventId":"x","type":"trade.updated","reference":"r","status":"FILLED"}'`
      Expected: `401` (no/invalid signature); a correctly-signed replay is idempotent.
- [ ] **No secret/PII in logs** — `grep -riE '(secret|password|S[A-Z2-7]{55}|accountNumber)' <captured app logs>`
      Expected: no plaintext secrets, wallet secrets (`S...`), full account numbers, or session tokens.
- [ ] **Docker image builds + runs non-root** — `docker build -t heypay:gate . && docker run --rm heypay:gate id -u`
      Expected: build succeeds; prints `1001`.
- [ ] **Railway config valid** — `node -e "JSON.parse(require('fs').readFileSync('railway.json','utf8'))"`
      Expected: no error; `web` + `worker` start commands present; release command = `prisma migrate deploy`; health check `/api/health`.
- [ ] **Commit the gate result**

```bash
git commit --allow-empty -m "chore: phase 9 quality gates verified (typecheck/lint/audit/unit/integration/e2e/docker)"
```

---

## Self-Review

**Spec coverage (this phase's slice):**

- **SPEC §6 webhooks** (`POST /api/webhooks/pdax`, signature/IP allowlist, untrusted/Zod, idempotent by external ref, advance via state machine, polling fallback) → **Task 2**.
- **SPEC §6 uploads** (`POST /api/uploads/presign`, content-type+size, `verifyUploadedObject` re-validation) → **Task 3**.
- **SPEC §10 testing** (unit/integration/e2e; mock rail + testnet happy path) → Tasks **5–8**, **12**; **resilience** (idempotent webhook/jobs) → Task 2.
- **SPEC §11 env** (authoritative list, all groups) → **Task 4** (+ cross-check command vs `src`/`tests`).
- **SPEC §12 deliverables** (docker-compose, Railway web+worker + migrate deploy, tests green in CI) → Tasks **5, 9, 10, 11, 12**.
- **AGENT §9 local dev bootstrap** → Task 12 clean-checkout item (mirrors §9 commands).
- **AGENT §10 `.env.example`** → Task 4 (extends §10 with webhook + e2e keys).
- **AGENT §11 Railway** (two services, pooled DB URL, release `migrate deploy`, health check, non-root multi-stage Dockerfile, one-off prod admin seed) → Tasks **9, 10**.
- **AGENT §12 quality gates** (typecheck/lint/format/audit, unit/integration/e2e, no secrets in logs, headers, CSRF/rate limits, clean-checkout, migrations+seed) → Tasks **11, 12** (each gate has an exact command).
- **AGENT §6 webhook security** (verify signature/allowlist, untrusted, idempotent by external ref) → Task 2; **file-upload security** (presigned, content-type/size, post-upload magic-byte verify) → Task 3.
- **Health endpoint** (Railway + Playwright readiness, public per AGENT §11) → **Task 1**.

**Placeholder scan:** No `TBD`/`TODO`/"add error handling"/"similar to Task N"/"write tests for the above". Every code step shows full file contents; every verify step gives an exact command + expected output. The e2e specs deliberately FAIL first (app-wiring gaps), then PASS — that is the prescribed TDD cycle, not a placeholder.

**Type/name consistency vs Locked Shared Contracts:**

- Money: `dec` (Task 2) matches `@/lib/money` contract.
- HTTP: `route`, `json`, `parseBody` (Task 3) match `@/lib/http`.
- Auth: `requireUser` (Task 3) matches `@/server/auth/sessions`.
- Storage: `presignUpload({prefix,contentType,maxBytes})` + `verifyUploadedObject(key)` (Task 3) match `@/server/storage/s3` verbatim.
- DB/Redis singletons `prisma`/`redis` (Tasks 1, 2) match the overview file map (`src/server/db.ts`, `src/server/redis.ts`).
- `IdempotencyKey` fields used (`key`, `scope`, `expiresAt`) match SPEC §4.
- `Payment` external-ref fields (`pdaxTradeRef`, `pdaxCashoutRef`) and statuses (`SETTLED`, `FAILED`, `REFUND_PENDING`, `REFUNDED`) match SPEC §4 + the authoritative state machine.
- **New cross-phase dependency declared:** `advanceOnRailCallback(...)` in `src/server/payments/state-machine.ts` (Phase 5) — Task 2 documents its exact signature in its Interfaces > Consumes block; if Phase 5 named it differently, reconcile there.
- **New env names** introduced (Task 4) and used: `PDAX_WEBHOOK_SECRET`, `PDAX_WEBHOOK_IP_ALLOWLIST` (Task 2), `S3_PUBLIC_URL`, `E2E_PORT`/`E2E_DATABASE_URL`/`E2E_REDIS_URL` (Tasks 5–6), `PORT`/`LOG_LEVEL`/`SENTRY_DSN` — all present in `.env.example` and validated by Task 4's cross-check command.

**Endpoint-path consistency:** `/api/webhooks/pdax`, `/api/uploads/presign`, `/api/health`, `/api/auth/signup`, `/api/wallet/deposit-address`, `/api/wallet/sync`, `/api/qrph/decode`, `/api/payments/quote`, `/api/payments/[id]/confirm`, `/api/payments/[id]`, `/api/merchant{,/me,/settlement,/qrph,/go-live}`, `/api/admin/payments/[id]/{retry,refund}` all match SPEC §6 and the earlier phases.

**Known coupling to verify at execution time:** the admin spec (Task 8) assumes MockProvider's forced-failure trigger is PHP amount `66.66`; the QRPH vector (Task 5 fixtures) is CRC-verified here but the seed/`resolveMerchant` must accept it. Both are flagged inline so the executor reconciles with Phases 4/3 rather than silently weakening a test.
