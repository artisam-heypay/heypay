# Phase 8: Admin UI & API — HeyPay

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `2026-06-28-heypay-00-overview.md` first — its **Global Constraints** and **Locked Shared Contracts** apply to every task here and are not repeated in full.

**Goal:** Build the `ADMIN` operator surface — system overview, user/merchant management, a full payments console with state-timeline + manual retry/refund, and a system-health dashboard — together with the `requireRole(ADMIN)` admin API (SPEC §6 Admin) and a public shallow health endpoint for Railway, with every admin mutation audited.

**Architecture:** Thin Route Handlers wrap a reusable admin service layer (`src/server/admin/*`); admin Server Components call those same service functions directly (no internal `fetch`), while interactive bits (search, activate/suspend toggles, retry/refund confirm dialogs, health auto-refresh) are Client Components that hit the API. Aggregation, listing (cursor-paginated), and mutations live in the service layer so they are unit/integration-testable once and consumed twice. Retry re-enqueues the settlement job via `enqueueSettle`; refund records a `REFUND_PENDING` transition then enqueues the worker, which owns the XLM-return branch of the state machine.

**Depends on: Phases 1–5** (overview + Global Constraints + Locked Shared Contracts). Specifically consumes: `lib/money.ts` (`Decimal`, `dec`, `displayPhp`, `displayXlm`), `lib/errors.ts` (`badRequest`, `notFound`, `conflict`, `forbidden`), `lib/http.ts` (`route`, `json`, `parseBody`, `parseQuery`), `server/auth/sessions.ts` (`getSessionUser`, `requireRole`), `server/auth/csrf.ts` (`assertSameOrigin`), `server/auth/audit.ts` (`audit`), `server/db.ts` (`prisma`), `server/redis.ts` (`redis`), `server/queue/queues.ts` (`QUEUE_NAMES`, `enqueueSettle`), `server/stellar/wallet.ts` (`walletService`), `server/rails/index.ts` (`rail`), and the Prisma enums/models from `@/generated/prisma`.

**Deliverable:** `/admin`, `/admin/users`, `/admin/merchants`, `/admin/payments`, `/admin/health` (themed per BRAND, `rounded-lg` data surfaces) plus `GET/PATCH/POST /api/admin/*` and `GET /api/health`, all `ADMIN`-gated, audited, and covered by integration tests (overview aggregation, deactivate user, merchant status change, retry re-enqueues, refund transitions to `REFUND_PENDING`, health reports per-component status) and component tests.

---

## Global Constraints (delta for this phase)

Inherit all constraints from the overview. The ones most load-bearing here:

- **AuthZ default-deny + audited override.** Every admin handler calls `await requireRole(Role.ADMIN)` (re-checked in-handler, never trusting `proxy.ts` alone). Every admin _mutation_ (`PATCH`/`POST`) calls `assertSameOrigin(req)` and writes an `AuditLog` row via `audit()` with `actorId = admin.id` (AGENT §6 "admin override audited").
- **Consistent error envelope** `{ error: { code, message, details? } }` via `route()`; never leak provider internals (Horizon/PDAX/Redis errors are summarized to a status string, full detail logged server-side).
- **Cursor-based pagination** for all lists (`?cursor=&limit=`), `limit` default 20, max 100, ordered `createdAt desc, id desc`.
- **Money is `Decimal`.** Aggregate XLM at 7dp, PHP at 2dp; format only at the view layer with `displayXlm`/`displayPhp`. Never `number` for money sums.
- **BRAND theming.** Admin = **data surface**: cards/buttons/panels use `rounded-lg` (never pills — pills are payer payment CTAs only), tables follow the merchant table pattern (`bg-surface-container-low` header with `label-md` `outline` headers, rows divided by `outline-variant`, amounts in `mono-data`, paired XLM/PHP). Status conveyed by **badge text + dot**, not color alone. Settled/confirmed/active = `primary`; pending/processing/live = `secondary`; error/suspended/failed = `error`. Respect `prefers-reduced-motion` (health auto-refresh must not animate when reduced-motion is set). Reference tokens only — no raw hex/px.
- **No secrets/PII leaked.** Admin user/payment lists never include password hashes, encrypted secrets, or full bank account numbers (show `accountNumberLast4` only).

---

## File Structure Map (this phase)

```
src/
├─ app/
│  ├─ (admin)/
│  │  ├─ layout.tsx                      # SideNav + requireRole(ADMIN) + force-pw-change gate  [Task 8]
│  │  └─ admin/
│  │     ├─ page.tsx                     # /admin overview                                       [Task 9]
│  │     ├─ users/page.tsx               # /admin/users                                          [Task 10]
│  │     ├─ merchants/page.tsx           # /admin/merchants                                      [Task 11]
│  │     ├─ payments/page.tsx            # /admin/payments                                       [Task 12]
│  │     └─ health/page.tsx              # /admin/health                                         [Task 13]
│  └─ api/
│     ├─ health/route.ts                 # public shallow health (Railway)                       [Task 7]
│     └─ admin/
│        ├─ overview/route.ts            # GET overview                                          [Task 1]
│        ├─ users/route.ts               # GET list                                              [Task 2]
│        ├─ users/[id]/route.ts          # PATCH activate/deactivate                             [Task 2]
│        ├─ merchants/route.ts           # GET list                                              [Task 3]
│        ├─ merchants/[id]/route.ts      # PATCH status                                          [Task 3]
│        ├─ payments/route.ts            # GET list + filters + cursor                           [Task 4]
│        ├─ payments/[id]/route.ts       # GET payment + events timeline                         [Task 4]
│        ├─ payments/[id]/retry/route.ts # POST retry (re-enqueue)                               [Task 5]
│        ├─ payments/[id]/refund/route.ts# POST refund (REFUND_PENDING)                          [Task 6]
│        └─ health/route.ts              # GET deep health                                       [Task 7]
├─ server/
│  └─ admin/
│     ├─ overview.ts                     # getOverview()                                         [Task 1]
│     ├─ users.ts                        # listUsers(), setUserActive()                          [Task 2]
│     ├─ merchants.ts                    # listAdminMerchants(), setMerchantStatus()             [Task 3]
│     ├─ payments.ts                     # listAdminPayments(), getAdminPayment(),
│     │                                  #   retryPayment(), refundPayment()                     [Task 4–6]
│     ├─ health.ts                       # checkHealth(), shallowHealth()                         [Task 7]
│     └─ pagination.ts                   # decodeCursor/encodeCursor + listQuerySchema           [Task 1]
├─ components/
│  └─ admin/
│     ├─ AdminSideNav.tsx                # left nav (data surface)                                [Task 8]
│     ├─ StatBadge.tsx                   # status pill chip (dot + label)                         [Task 1]
│     ├─ StatCard.tsx                    # overview metric card                                   [Task 9]
│     ├─ ConfirmDialog.tsx              # accessible confirm modal                                [Task 12]
│     ├─ UserActiveToggle.tsx           # client: activate/deactivate                            [Task 10]
│     ├─ MerchantStatusControl.tsx       # client: activate/suspend                               [Task 11]
│     ├─ PaymentRow.tsx                  # client: row + timeline drawer + retry/refund           [Task 12]
│     └─ HealthTiles.tsx                 # client: tiles + auto-refresh                           [Task 13]
└─ tests/
   ├─ integration/admin/                 # overview, users, merchants, payments, retry, refund, health
   └─ components/admin/                   # toggles, dialog, health tiles
```

---

## Interfaces Produced by this phase (added to the shared surface)

Later code may rely on these; defined here, used here.

```typescript
// src/server/admin/overview.ts
import { Decimal } from "@/lib/money";
export type AdminOverview = {
  counts: {
    users: number;
    payers: number;
    merchants: number;
    activeMerchants: number;
    payments: number;
    settledPayments: number;
    failedPayments: number;
  };
  volume: { totalXlm: Decimal; totalPhpSettled: Decimal }; // Decimal, 7dp / 2dp
  recentFailures: Array<{
    id: string;
    reference: string;
    merchantName: string;
    amountPhp: Decimal;
    failureReason: string | null;
    createdAt: Date;
  }>;
};
export function getOverview(): Promise<AdminOverview>;

// src/server/admin/pagination.ts
import { z } from "zod";
export const listQuerySchema: z.ZodObject<{
  cursor: z.ZodOptional<z.ZodString>;
  limit: z.ZodDefault<z.ZodNumber>; // coerced int 1..100, default 20
  q: z.ZodOptional<z.ZodString>;
  status: z.ZodOptional<z.ZodString>;
}>;
export type Page<T> = { items: T[]; nextCursor: string | null };
// Cursor is the opaque base64 of the last row's `${createdAt.toISOString()}|${id}`.
export function encodeCursor(row: { createdAt: Date; id: string }): string;
export function decodeCursor(cursor: string): { createdAt: Date; id: string };

// src/server/admin/users.ts
import { Role } from "@/generated/prisma";
export type AdminUserRow = {
  id: string;
  username: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
};
export function listUsers(input: {
  cursor?: string;
  limit: number;
  q?: string;
}): Promise<Page<AdminUserRow>>;
export function setUserActive(input: {
  id: string;
  isActive: boolean;
  actorId: string;
  ip?: string;
}): Promise<AdminUserRow>;

// src/server/admin/merchants.ts
import { MerchantStatus } from "@/generated/prisma";
export type AdminMerchantRow = {
  id: string;
  businessName: string;
  status: MerchantStatus;
  username: string;
  accountNumberLast4: string;
  settlementBankName: string;
  createdAt: Date;
};
export function listAdminMerchants(input: {
  cursor?: string;
  limit: number;
  q?: string;
  status?: MerchantStatus;
}): Promise<Page<AdminMerchantRow>>;
export function setMerchantStatus(input: {
  id: string;
  status: MerchantStatus;
  actorId: string;
  ip?: string;
}): Promise<AdminMerchantRow>;

// src/server/admin/payments.ts
import { Decimal } from "@/lib/money";
import { PaymentStatus } from "@/generated/prisma";
export type AdminPaymentRow = {
  id: string;
  reference: string;
  status: PaymentStatus;
  payerUsername: string;
  merchantName: string;
  amountPhp: Decimal;
  amountXlm: Decimal;
  failureReason: string | null;
  createdAt: Date;
};
export type AdminPaymentEvent = {
  id: string;
  fromStatus: PaymentStatus | null;
  toStatus: PaymentStatus;
  detail: unknown;
  createdAt: Date;
};
export type AdminPaymentDetail = AdminPaymentRow & {
  events: AdminPaymentEvent[];
  stellarTxHash: string | null;
  pdaxTradeRef: string | null;
  pdaxCashoutRef: string | null;
};
export function listAdminPayments(input: {
  cursor?: string;
  limit: number;
  status?: PaymentStatus;
  q?: string;
}): Promise<Page<AdminPaymentRow>>;
export function getAdminPayment(id: string): Promise<AdminPaymentDetail | null>;
// Re-enqueue the settlement worker from the payment's current status. Audited. Throws conflict on terminal-success/refund states.
export function retryPayment(input: {
  id: string;
  actorId: string;
  ip?: string;
}): Promise<{ id: string; status: PaymentStatus }>;
// Transition to REFUND_PENDING + record PaymentEvent + enqueue worker (worker returns XLM). Audited. Throws conflict if not refundable.
export function refundPayment(input: {
  id: string;
  actorId: string;
  ip?: string;
}): Promise<{ id: string; status: PaymentStatus }>;

// src/server/admin/health.ts
export type ComponentHealth = {
  name: "stellar" | "pdax" | "redis" | "queue";
  status: "ok" | "degraded" | "down";
  detail: string;
  latencyMs?: number;
  queueDepth?: number;
};
export type SystemHealth = {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  components: ComponentHealth[];
};
export function checkHealth(): Promise<SystemHealth>; // deep (admin)
export function shallowHealth(): Promise<{ status: "ok"; uptimeSec: number }>; // public/Railway
```

---

## Task 1: Overview aggregation service + API (`GET /api/admin/overview`)

**Files:**

- Create: `src/server/admin/pagination.ts`
- Create: `src/server/admin/overview.ts`
- Create: `src/components/admin/StatBadge.tsx`
- Create: `src/app/api/admin/overview/route.ts`
- Test: `tests/integration/admin/overview.test.ts`

**Interfaces:**

- Consumes: `prisma` (`@/server/db`); `Role`, `PaymentStatus`, `MerchantStatus` (`@/generated/prisma`); `Decimal`, `dec`, `displayPhp` (`@/lib/money`); `route`, `json` (`@/lib/http`); `requireRole` (`@/server/auth/sessions`).
- Produces: `getOverview()`, `AdminOverview`; `listQuerySchema`, `encodeCursor`, `decodeCursor`, `Page<T>`; `<StatBadge>`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/admin/overview.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "@/app/api/admin/overview/route";
import { prisma } from "@/server/db";
import { dec } from "@/lib/money";
import { asAdmin, asPayer, makeRequest, seedPayment, resetDb } from "../helpers";

describe("GET /api/admin/overview", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("403s for non-admin", async () => {
    await asPayer();
    const res = await GET(makeRequest("GET", "/api/admin/overview"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(403);
  });

  it("aggregates counts, volume, and recent failures", async () => {
    await asAdmin();
    await seedPayment({
      status: "SETTLED",
      amountPhp: dec("100.00"),
      amountXlm: dec("10.0000000"),
      netSettledPhp: dec("98.50"),
    });
    await seedPayment({
      status: "SETTLED",
      amountPhp: dec("50.00"),
      amountXlm: dec("5.0000000"),
      netSettledPhp: dec("49.00"),
    });
    await seedPayment({
      status: "FAILED",
      amountPhp: dec("20.00"),
      amountXlm: dec("2.0000000"),
      failureReason: "PDAX trade rejected",
    });

    const res = await GET(makeRequest("GET", "/api/admin/overview"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts.payments).toBe(3);
    expect(body.counts.settledPayments).toBe(2);
    expect(body.counts.failedPayments).toBe(1);
    expect(body.volume.totalXlm).toBe("15.0000000"); // 10 + 5 (settled legs)
    expect(body.volume.totalPhpSettled).toBe("147.50"); // 98.50 + 49.00
    expect(body.recentFailures).toHaveLength(1);
    expect(body.recentFailures[0].failureReason).toBe("PDAX trade rejected");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/admin/overview.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/admin/overview/route'`.

- [ ] **Step 3: Write `src/server/admin/pagination.ts`**

```typescript
import "server-only";
import { z } from "zod";

export const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
});

export type Page<T> = { items: T[]; nextCursor: string | null };

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const idx = raw.lastIndexOf("|");
  if (idx === -1) throw new Error("bad cursor");
  const createdAt = new Date(raw.slice(0, idx));
  const id = raw.slice(idx + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) throw new Error("bad cursor");
  return { createdAt, id };
}
```

- [ ] **Step 4: Write `src/server/admin/overview.ts`**

```typescript
import "server-only";
import { prisma } from "@/server/db";
import { dec, Decimal } from "@/lib/money";

export type AdminOverview = {
  counts: {
    users: number;
    payers: number;
    merchants: number;
    activeMerchants: number;
    payments: number;
    settledPayments: number;
    failedPayments: number;
  };
  volume: { totalXlm: Decimal; totalPhpSettled: Decimal };
  recentFailures: Array<{
    id: string;
    reference: string;
    merchantName: string;
    amountPhp: Decimal;
    failureReason: string | null;
    createdAt: Date;
  }>;
};

export async function getOverview(): Promise<AdminOverview> {
  const [
    users,
    payers,
    merchants,
    activeMerchants,
    payments,
    settledPayments,
    failedPayments,
    settledAgg,
    failures,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: "PAYER" } }),
    prisma.merchant.count(),
    prisma.merchant.count({ where: { status: "ACTIVE" } }),
    prisma.payment.count(),
    prisma.payment.count({ where: { status: "SETTLED" } }),
    prisma.payment.count({ where: { status: "FAILED" } }),
    prisma.payment.aggregate({
      where: { status: "SETTLED" },
      _sum: { amountXlm: true, netSettledPhp: true },
    }),
    prisma.payment.findMany({
      where: { status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { merchant: { select: { businessName: true } } },
    }),
  ]);

  return {
    counts: {
      users,
      payers,
      merchants,
      activeMerchants,
      payments,
      settledPayments,
      failedPayments,
    },
    volume: {
      totalXlm: dec(settledAgg._sum.amountXlm?.toString() ?? "0"),
      totalPhpSettled: dec(settledAgg._sum.netSettledPhp?.toString() ?? "0"),
    },
    recentFailures: failures.map((p) => ({
      id: p.id,
      reference: p.reference,
      merchantName: p.merchant.businessName,
      amountPhp: dec(p.amountPhp.toString()),
      failureReason: p.failureReason,
      createdAt: p.createdAt,
    })),
  };
}
```

- [ ] **Step 5: Write `src/components/admin/StatBadge.tsx`** (reused by every admin list)

```tsx
import type { ReactNode } from "react";

type Tone = "settled" | "pending" | "error" | "neutral";

const TONE: Record<Tone, { chip: string; dot: string }> = {
  settled: { chip: "bg-primary/10 text-primary", dot: "bg-primary" },
  pending: { chip: "bg-secondary/10 text-secondary", dot: "bg-secondary" },
  error: { chip: "bg-error/10 text-error", dot: "bg-error" },
  neutral: { chip: "bg-surface-container-high text-on-surface-variant", dot: "bg-outline" },
};

export function StatBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const t = TONE[tone];
  return (
    <span
      className={`inline-flex items-center gap-stack-sm rounded-full px-3 py-1 text-label-md uppercase ${t.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden="true" />
      {children}
    </span>
  );
}
```

- [ ] **Step 6: Write `src/app/api/admin/overview/route.ts`**

```typescript
import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { getOverview } from "@/server/admin/overview";
import { displayXlm, displayPhp } from "@/lib/money";

export const GET = route(async () => {
  await requireRole("ADMIN");
  const o = await getOverview();
  return json({
    counts: o.counts,
    volume: {
      totalXlm: o.volume.totalXlm.toFixed(7),
      totalPhpSettled: o.volume.totalPhpSettled.toFixed(2),
      displayXlm: displayXlm(o.volume.totalXlm),
      displayPhp: displayPhp(o.volume.totalPhpSettled),
    },
    recentFailures: o.recentFailures.map((f) => ({
      id: f.id,
      reference: f.reference,
      merchantName: f.merchantName,
      amountPhp: f.amountPhp.toFixed(2),
      failureReason: f.failureReason,
      createdAt: f.createdAt.toISOString(),
    })),
  });
});
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/admin/overview.test.ts`
Expected: PASS (both cases).

- [ ] **Step 8: Commit**

```bash
git add src/server/admin/pagination.ts src/server/admin/overview.ts src/components/admin/StatBadge.tsx src/app/api/admin/overview/route.ts tests/integration/admin/overview.test.ts
git commit -m "feat(admin): overview aggregation service + GET /api/admin/overview"
```

---

## Task 2: Users API (`GET /api/admin/users`, `PATCH /api/admin/users/[id]`)

**Files:**

- Create: `src/server/admin/users.ts`
- Create: `src/app/api/admin/users/route.ts`
- Create: `src/app/api/admin/users/[id]/route.ts`
- Test: `tests/integration/admin/users.test.ts`

**Interfaces:**

- Consumes: `prisma`; `Role`; `route`, `json`, `parseQuery`, `parseBody`; `requireRole`; `assertSameOrigin` (`@/server/auth/csrf`); `audit` (`@/server/auth/audit`); `notFound`, `badRequest` (`@/lib/errors`); `listQuerySchema`, `encodeCursor`, `decodeCursor`, `Page` (`@/server/admin/pagination`).
- Produces: `listUsers()`, `setUserActive()`, `AdminUserRow`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/admin/users.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "@/app/api/admin/users/route";
import { PATCH } from "@/app/api/admin/users/[id]/route";
import { prisma } from "@/server/db";
import { asAdmin, asPayer, makeRequest, seedUser, resetDb } from "../helpers";

describe("admin users", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists users (cursor paginated) and filters by q", async () => {
    await asAdmin();
    await seedUser({ username: "alice", role: "PAYER" });
    await seedUser({ username: "bob", role: "MERCHANT" });
    const res = await GET(makeRequest("GET", "/api/admin/users?q=ali&limit=10"), {
      params: Promise.resolve({}),
    });
    const body = await res.json();
    expect(body.items.map((u: any) => u.username)).toContain("alice");
    expect(body.items.every((u: any) => u.passwordHash === undefined)).toBe(true);
  });

  it("deactivates a user and writes an audit log", async () => {
    const admin = await asAdmin();
    const u = await seedUser({ username: "carol", role: "PAYER" });
    const res = await PATCH(makeRequest("PATCH", `/api/admin/users/${u.id}`, { isActive: false }), {
      params: Promise.resolve({ id: u.id }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).isActive).toBe(false);
    expect((await prisma.user.findUnique({ where: { id: u.id } }))!.isActive).toBe(false);
    const log = await prisma.auditLog.findFirst({
      where: { action: "admin.user.deactivate", target: u.id },
    });
    expect(log?.actorId).toBe(admin.id);
  });

  it("rejects PATCH from non-admin", async () => {
    await asPayer();
    const u = await seedUser({ username: "dave", role: "PAYER" });
    const res = await PATCH(makeRequest("PATCH", `/api/admin/users/${u.id}`, { isActive: false }), {
      params: Promise.resolve({ id: u.id }),
    });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/admin/users.test.ts`
Expected: FAIL — modules for the two routes not found.

- [ ] **Step 3: Write `src/server/admin/users.ts`**

```typescript
import "server-only";
import { prisma } from "@/server/db";
import { Role } from "@/generated/prisma";
import { audit } from "@/server/auth/audit";
import { notFound } from "@/lib/errors";
import { encodeCursor, decodeCursor, type Page } from "./pagination";

export type AdminUserRow = {
  id: string;
  username: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
};

const SELECT = { id: true, username: true, role: true, isActive: true, createdAt: true } as const;

export async function listUsers(input: {
  cursor?: string;
  limit: number;
  q?: string;
}): Promise<Page<AdminUserRow>> {
  const where = input.q ? { username: { contains: input.q, mode: "insensitive" as const } } : {};
  const cur = input.cursor ? decodeCursor(input.cursor) : null;
  const rows = await prisma.user.findMany({
    where: cur
      ? {
          AND: [
            where,
            {
              OR: [
                { createdAt: { lt: cur.createdAt } },
                { createdAt: cur.createdAt, id: { lt: cur.id } },
              ],
            },
          ],
        }
      : where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    select: SELECT,
  });
  const items = rows.slice(0, input.limit);
  const nextCursor = rows.length > input.limit ? encodeCursor(items[items.length - 1]) : null;
  return { items, nextCursor };
}

export async function setUserActive(input: {
  id: string;
  isActive: boolean;
  actorId: string;
  ip?: string;
}): Promise<AdminUserRow> {
  const existing = await prisma.user.findUnique({ where: { id: input.id }, select: { id: true } });
  if (!existing) throw notFound("User not found");
  const user = await prisma.user.update({
    where: { id: input.id },
    data: { isActive: input.isActive },
    select: SELECT,
  });
  await audit({
    actorId: input.actorId,
    action: input.isActive ? "admin.user.activate" : "admin.user.deactivate",
    target: input.id,
    metadata: { isActive: input.isActive },
    ip: input.ip,
  });
  return user;
}
```

- [ ] **Step 4: Write `src/app/api/admin/users/route.ts`**

```typescript
import { route, json, parseQuery } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { listQuerySchema } from "@/server/admin/pagination";
import { listUsers } from "@/server/admin/users";

export const GET = route(async (req) => {
  await requireRole("ADMIN");
  const q = parseQuery(req, listQuerySchema);
  const page = await listUsers({ cursor: q.cursor, limit: q.limit, q: q.q });
  return json({
    items: page.items.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
    nextCursor: page.nextCursor,
  });
});
```

- [ ] **Step 5: Write `src/app/api/admin/users/[id]/route.ts`**

```typescript
import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { setUserActive } from "@/server/admin/users";

const bodySchema = z.object({ isActive: z.boolean() });

export const PATCH = route(async (req, ctx) => {
  assertSameOrigin(req);
  const admin = await requireRole("ADMIN");
  const { isActive } = await parseBody(req, bodySchema);
  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const user = await setUserActive({ id: ctx.params.id, isActive, actorId: admin.id, ip });
  return json({ ...user, createdAt: user.createdAt.toISOString() });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/admin/users.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 7: Commit**

```bash
git add src/server/admin/users.ts src/app/api/admin/users tests/integration/admin/users.test.ts
git commit -m "feat(admin): users list + activate/deactivate API (audited)"
```

---

## Task 3: Merchants API (`GET /api/admin/merchants`, `PATCH /api/admin/merchants/[id]`)

**Files:**

- Create: `src/server/admin/merchants.ts`
- Create: `src/app/api/admin/merchants/route.ts`
- Create: `src/app/api/admin/merchants/[id]/route.ts`
- Test: `tests/integration/admin/merchants.test.ts`

**Interfaces:**

- Consumes: `prisma`; `MerchantStatus`; `route`, `json`, `parseQuery`, `parseBody`; `requireRole`; `assertSameOrigin`; `audit`; `notFound`, `badRequest`; pagination helpers.
- Produces: `listAdminMerchants()`, `setMerchantStatus()`, `AdminMerchantRow`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/admin/merchants.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "@/app/api/admin/merchants/route";
import { PATCH } from "@/app/api/admin/merchants/[id]/route";
import { prisma } from "@/server/db";
import { asAdmin, makeRequest, seedMerchant, resetDb } from "../helpers";

describe("admin merchants", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists merchants, never leaking full account numbers", async () => {
    await asAdmin();
    await seedMerchant({
      businessName: "Sari Store",
      status: "PENDING_REVIEW",
      accountNumberLast4: "4321",
    });
    const res = await GET(makeRequest("GET", "/api/admin/merchants?status=PENDING_REVIEW"), {
      params: Promise.resolve({}),
    });
    const body = await res.json();
    expect(body.items[0].businessName).toBe("Sari Store");
    expect(body.items[0].accountNumberLast4).toBe("4321");
    expect(body.items[0].accountNumber).toBeUndefined();
  });

  it("activates a PENDING_REVIEW merchant and audits the override", async () => {
    const admin = await asAdmin();
    const m = await seedMerchant({ status: "PENDING_REVIEW" });
    const res = await PATCH(
      makeRequest("PATCH", `/api/admin/merchants/${m.id}`, { status: "ACTIVE" }),
      { params: Promise.resolve({ id: m.id }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ACTIVE");
    const log = await prisma.auditLog.findFirst({
      where: { action: "admin.merchant.status", target: m.id },
    });
    expect(log?.actorId).toBe(admin.id);
    expect((log?.metadata as any).status).toBe("ACTIVE");
  });

  it("rejects an invalid status value", async () => {
    await asAdmin();
    const m = await seedMerchant({ status: "PENDING_REVIEW" });
    const res = await PATCH(
      makeRequest("PATCH", `/api/admin/merchants/${m.id}`, { status: "BOGUS" }),
      { params: Promise.resolve({ id: m.id }) },
    );
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/admin/merchants.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Write `src/server/admin/merchants.ts`**

```typescript
import "server-only";
import { prisma } from "@/server/db";
import { MerchantStatus } from "@/generated/prisma";
import { audit } from "@/server/auth/audit";
import { notFound } from "@/lib/errors";
import { encodeCursor, decodeCursor, type Page } from "./pagination";

export type AdminMerchantRow = {
  id: string;
  businessName: string;
  status: MerchantStatus;
  username: string;
  accountNumberLast4: string;
  settlementBankName: string;
  createdAt: Date;
};

function toRow(m: {
  id: string;
  businessName: string;
  status: MerchantStatus;
  accountNumberLast4: string;
  settlementBankName: string;
  createdAt: Date;
  user: { username: string };
}): AdminMerchantRow {
  return {
    id: m.id,
    businessName: m.businessName,
    status: m.status,
    username: m.user.username,
    accountNumberLast4: m.accountNumberLast4,
    settlementBankName: m.settlementBankName,
    createdAt: m.createdAt,
  };
}

const INCLUDE = { user: { select: { username: true } } } as const;

export async function listAdminMerchants(input: {
  cursor?: string;
  limit: number;
  q?: string;
  status?: MerchantStatus;
}): Promise<Page<AdminMerchantRow>> {
  const filters: Record<string, unknown>[] = [];
  if (input.q) filters.push({ businessName: { contains: input.q, mode: "insensitive" } });
  if (input.status) filters.push({ status: input.status });
  const cur = input.cursor ? decodeCursor(input.cursor) : null;
  if (cur)
    filters.push({
      OR: [{ createdAt: { lt: cur.createdAt } }, { createdAt: cur.createdAt, id: { lt: cur.id } }],
    });
  const rows = await prisma.merchant.findMany({
    where: filters.length ? { AND: filters } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    include: INCLUDE,
  });
  const sliced = rows.slice(0, input.limit);
  const items = sliced.map(toRow);
  const nextCursor = rows.length > input.limit ? encodeCursor(sliced[sliced.length - 1]) : null;
  return { items, nextCursor };
}

export async function setMerchantStatus(input: {
  id: string;
  status: MerchantStatus;
  actorId: string;
  ip?: string;
}): Promise<AdminMerchantRow> {
  const existing = await prisma.merchant.findUnique({
    where: { id: input.id },
    select: { id: true },
  });
  if (!existing) throw notFound("Merchant not found");
  const merchant = await prisma.merchant.update({
    where: { id: input.id },
    data: { status: input.status },
    include: INCLUDE,
  });
  await audit({
    actorId: input.actorId,
    action: "admin.merchant.status",
    target: input.id,
    metadata: { status: input.status },
    ip: input.ip,
  });
  return toRow(merchant);
}
```

- [ ] **Step 4: Write `src/app/api/admin/merchants/route.ts`**

```typescript
import { route, json, parseQuery } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { MerchantStatus } from "@/generated/prisma";
import { listQuerySchema } from "@/server/admin/pagination";
import { listAdminMerchants } from "@/server/admin/merchants";

export const GET = route(async (req) => {
  await requireRole("ADMIN");
  const q = parseQuery(req, listQuerySchema);
  const status = q.status && q.status in MerchantStatus ? (q.status as MerchantStatus) : undefined;
  const page = await listAdminMerchants({ cursor: q.cursor, limit: q.limit, q: q.q, status });
  return json({
    items: page.items.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
    nextCursor: page.nextCursor,
  });
});
```

- [ ] **Step 5: Write `src/app/api/admin/merchants/[id]/route.ts`**

```typescript
import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { MerchantStatus } from "@/generated/prisma";
import { setMerchantStatus } from "@/server/admin/merchants";

const bodySchema = z.object({ status: z.nativeEnum(MerchantStatus) });

export const PATCH = route(async (req, ctx) => {
  assertSameOrigin(req);
  const admin = await requireRole("ADMIN");
  const { status } = await parseBody(req, bodySchema);
  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const merchant = await setMerchantStatus({ id: ctx.params.id, status, actorId: admin.id, ip });
  return json({ ...merchant, createdAt: merchant.createdAt.toISOString() });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/admin/merchants.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/admin/merchants.ts src/app/api/admin/merchants tests/integration/admin/merchants.test.ts
git commit -m "feat(admin): merchants list + status change API (audited)"
```

---

## Task 4: Payments list + detail API (`GET /api/admin/payments`, `GET /api/admin/payments/[id]`)

**Files:**

- Create: `src/server/admin/payments.ts` (list + detail now; retry/refund added in Tasks 5–6)
- Create: `src/app/api/admin/payments/route.ts`
- Create: `src/app/api/admin/payments/[id]/route.ts`
- Test: `tests/integration/admin/payments.test.ts`

**Interfaces:**

- Consumes: `prisma`; `PaymentStatus`; `Decimal`, `dec`; `route`, `json`, `parseQuery`; `requireRole`; `notFound`; pagination helpers.
- Produces: `listAdminPayments()`, `getAdminPayment()`, `AdminPaymentRow`, `AdminPaymentEvent`, `AdminPaymentDetail`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/admin/payments.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { GET as LIST } from "@/app/api/admin/payments/route";
import { GET as DETAIL } from "@/app/api/admin/payments/[id]/route";
import { dec } from "@/lib/money";
import { asAdmin, makeRequest, seedPayment, resetDb } from "../helpers";

describe("admin payments read", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists all payments and filters by status", async () => {
    await asAdmin();
    await seedPayment({ status: "SETTLED", amountPhp: dec("100.00") });
    await seedPayment({ status: "FAILED", amountPhp: dec("20.00"), failureReason: "x" });
    const res = await LIST(makeRequest("GET", "/api/admin/payments?status=FAILED"), {
      params: Promise.resolve({}),
    });
    const body = await res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].status).toBe("FAILED");
  });

  it("returns a payment with its event timeline", async () => {
    await asAdmin();
    const p = await seedPayment({ status: "SETTLED", withEvents: true });
    const res = await DETAIL(makeRequest("GET", `/api/admin/payments/${p.id}`), {
      params: Promise.resolve({ id: p.id }),
    });
    const body = await res.json();
    expect(body.reference).toBe(p.reference);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events[0]).toHaveProperty("toStatus");
  });

  it("404s an unknown payment", async () => {
    await asAdmin();
    const res = await DETAIL(makeRequest("GET", "/api/admin/payments/nope"), {
      params: Promise.resolve({ id: "nope" }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/admin/payments.test.ts`
Expected: FAIL — route modules not found.

- [ ] **Step 3: Write `src/server/admin/payments.ts`** (read functions)

```typescript
import "server-only";
import { prisma } from "@/server/db";
import { PaymentStatus } from "@/generated/prisma";
import { dec, Decimal } from "@/lib/money";
import { encodeCursor, decodeCursor, type Page } from "./pagination";

export type AdminPaymentRow = {
  id: string;
  reference: string;
  status: PaymentStatus;
  payerUsername: string;
  merchantName: string;
  amountPhp: Decimal;
  amountXlm: Decimal;
  failureReason: string | null;
  createdAt: Date;
};
export type AdminPaymentEvent = {
  id: string;
  fromStatus: PaymentStatus | null;
  toStatus: PaymentStatus;
  detail: unknown;
  createdAt: Date;
};
export type AdminPaymentDetail = AdminPaymentRow & {
  events: AdminPaymentEvent[];
  stellarTxHash: string | null;
  pdaxTradeRef: string | null;
  pdaxCashoutRef: string | null;
};

const ROW_INCLUDE = {
  payer: { select: { username: true } },
  merchant: { select: { businessName: true } },
} as const;

function toRow(p: {
  id: string;
  reference: string;
  status: PaymentStatus;
  amountPhp: unknown;
  amountXlm: unknown;
  failureReason: string | null;
  createdAt: Date;
  payer: { username: string };
  merchant: { businessName: string };
}): AdminPaymentRow {
  return {
    id: p.id,
    reference: p.reference,
    status: p.status,
    payerUsername: p.payer.username,
    merchantName: p.merchant.businessName,
    amountPhp: dec(String(p.amountPhp)),
    amountXlm: dec(String(p.amountXlm)),
    failureReason: p.failureReason,
    createdAt: p.createdAt,
  };
}

export async function listAdminPayments(input: {
  cursor?: string;
  limit: number;
  status?: PaymentStatus;
  q?: string;
}): Promise<Page<AdminPaymentRow>> {
  const filters: Record<string, unknown>[] = [];
  if (input.status) filters.push({ status: input.status });
  if (input.q)
    filters.push({
      OR: [
        { reference: { contains: input.q, mode: "insensitive" } },
        { payer: { username: { contains: input.q, mode: "insensitive" } } },
        { merchant: { businessName: { contains: input.q, mode: "insensitive" } } },
      ],
    });
  const cur = input.cursor ? decodeCursor(input.cursor) : null;
  if (cur)
    filters.push({
      OR: [{ createdAt: { lt: cur.createdAt } }, { createdAt: cur.createdAt, id: { lt: cur.id } }],
    });
  const rows = await prisma.payment.findMany({
    where: filters.length ? { AND: filters } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
    include: ROW_INCLUDE,
  });
  const sliced = rows.slice(0, input.limit);
  const items = sliced.map(toRow);
  const nextCursor = rows.length > input.limit ? encodeCursor(sliced[sliced.length - 1]) : null;
  return { items, nextCursor };
}

export async function getAdminPayment(id: string): Promise<AdminPaymentDetail | null> {
  const p = await prisma.payment.findUnique({
    where: { id },
    include: { ...ROW_INCLUDE, events: { orderBy: { createdAt: "asc" } } },
  });
  if (!p) return null;
  return {
    ...toRow(p),
    stellarTxHash: p.stellarTxHash,
    pdaxTradeRef: p.pdaxTradeRef,
    pdaxCashoutRef: p.pdaxCashoutRef,
    events: p.events.map((e) => ({
      id: e.id,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      detail: e.detail,
      createdAt: e.createdAt,
    })),
  };
}
```

- [ ] **Step 4: Write `src/app/api/admin/payments/route.ts`**

```typescript
import { route, json, parseQuery } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { PaymentStatus } from "@/generated/prisma";
import { listQuerySchema } from "@/server/admin/pagination";
import { listAdminPayments } from "@/server/admin/payments";

export const GET = route(async (req) => {
  await requireRole("ADMIN");
  const q = parseQuery(req, listQuerySchema);
  const status = q.status && q.status in PaymentStatus ? (q.status as PaymentStatus) : undefined;
  const page = await listAdminPayments({ cursor: q.cursor, limit: q.limit, status, q: q.q });
  return json({
    items: page.items.map((p) => ({
      ...p,
      amountPhp: p.amountPhp.toFixed(2),
      amountXlm: p.amountXlm.toFixed(7),
      createdAt: p.createdAt.toISOString(),
    })),
    nextCursor: page.nextCursor,
  });
});
```

- [ ] **Step 5: Write `src/app/api/admin/payments/[id]/route.ts`**

```typescript
import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { notFound } from "@/lib/errors";
import { getAdminPayment } from "@/server/admin/payments";

export const GET = route(async (_req, ctx) => {
  await requireRole("ADMIN");
  const p = await getAdminPayment(ctx.params.id);
  if (!p) throw notFound("Payment not found");
  return json({
    ...p,
    amountPhp: p.amountPhp.toFixed(2),
    amountXlm: p.amountXlm.toFixed(7),
    createdAt: p.createdAt.toISOString(),
    events: p.events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
  });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/admin/payments.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/admin/payments.ts src/app/api/admin/payments/route.ts "src/app/api/admin/payments/[id]/route.ts" tests/integration/admin/payments.test.ts
git commit -m "feat(admin): payments list + detail-with-timeline API"
```

---

## Task 5: Payment retry API (`POST /api/admin/payments/[id]/retry`)

**Files:**

- Modify: `src/server/admin/payments.ts` (add `retryPayment`)
- Create: `src/app/api/admin/payments/[id]/retry/route.ts`
- Test: `tests/integration/admin/payment-retry.test.ts`

**Interfaces:**

- Consumes: `prisma`; `PaymentStatus`; `enqueueSettle` (`@/server/queue/queues`); `audit`; `conflict`, `notFound`; `route`, `json`; `requireRole`; `assertSameOrigin`.
- Produces: `retryPayment({ id, actorId, ip }) => { id, status }`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/admin/payment-retry.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/admin/payments/[id]/retry/route";
import { prisma } from "@/server/db";
import { dec } from "@/lib/money";
import * as queues from "@/server/queue/queues";
import { asAdmin, makeRequest, seedPayment, resetDb } from "../helpers";

describe("POST /api/admin/payments/[id]/retry", () => {
  beforeEach(async () => {
    await resetDb();
    vi.restoreAllMocks();
  });

  it("re-enqueues settlement for a FAILED payment, records an event, and audits", async () => {
    const admin = await asAdmin();
    const spy = vi.spyOn(queues, "enqueueSettle").mockResolvedValue();
    const p = await seedPayment({
      status: "FAILED",
      failureReason: "PDAX timeout",
      amountPhp: dec("100.00"),
    });
    const res = await POST(makeRequest("POST", `/api/admin/payments/${p.id}/retry`, {}), {
      params: Promise.resolve({ id: p.id }),
    });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(p.id);
    const event = await prisma.paymentEvent.findFirst({
      where: { paymentId: p.id },
      orderBy: { createdAt: "desc" },
    });
    expect((event!.detail as any).action).toBe("admin.retry");
    const log = await prisma.auditLog.findFirst({
      where: { action: "admin.payment.retry", target: p.id },
    });
    expect(log?.actorId).toBe(admin.id);
  });

  it("409s when the payment is already SETTLED", async () => {
    await asAdmin();
    vi.spyOn(queues, "enqueueSettle").mockResolvedValue();
    const p = await seedPayment({ status: "SETTLED" });
    const res = await POST(makeRequest("POST", `/api/admin/payments/${p.id}/retry`, {}), {
      params: Promise.resolve({ id: p.id }),
    });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/admin/payment-retry.test.ts`
Expected: FAIL — retry route module not found.

- [ ] **Step 3: Add `retryPayment` to `src/server/admin/payments.ts`**

```typescript
// append to src/server/admin/payments.ts
import { enqueueSettle } from "@/server/queue/queues";
import { audit } from "@/server/auth/audit";
import { conflict, notFound } from "@/lib/errors";

// Statuses from which a retry makes no sense (already done / refund track).
const NON_RETRYABLE: PaymentStatus[] = ["SETTLED", "REFUND_PENDING", "REFUNDED"];

export async function retryPayment(input: {
  id: string;
  actorId: string;
  ip?: string;
}): Promise<{ id: string; status: PaymentStatus }> {
  const p = await prisma.payment.findUnique({
    where: { id: input.id },
    select: { id: true, status: true },
  });
  if (!p) throw notFound("Payment not found");
  if (NON_RETRYABLE.includes(p.status)) {
    throw conflict(`Cannot retry a ${p.status} payment`, { status: p.status });
  }
  await prisma.paymentEvent.create({
    data: {
      paymentId: p.id,
      fromStatus: p.status,
      toStatus: p.status,
      detail: { action: "admin.retry", actorId: input.actorId },
    },
  });
  await enqueueSettle(p.id); // worker resumes from current status (jobId = paymentId:status)
  await audit({
    actorId: input.actorId,
    action: "admin.payment.retry",
    target: p.id,
    metadata: { fromStatus: p.status },
    ip: input.ip,
  });
  return { id: p.id, status: p.status };
}
```

- [ ] **Step 4: Write `src/app/api/admin/payments/[id]/retry/route.ts`**

```typescript
import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { retryPayment } from "@/server/admin/payments";

export const POST = route(async (req, ctx) => {
  assertSameOrigin(req);
  const admin = await requireRole("ADMIN");
  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const result = await retryPayment({ id: ctx.params.id, actorId: admin.id, ip });
  return json(result);
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/admin/payment-retry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/admin/payments.ts "src/app/api/admin/payments/[id]/retry/route.ts" tests/integration/admin/payment-retry.test.ts
git commit -m "feat(admin): manual payment retry re-enqueues settlement (audited)"
```

---

## Task 6: Payment refund API (`POST /api/admin/payments/[id]/refund`)

**Files:**

- Modify: `src/server/admin/payments.ts` (add `refundPayment`)
- Create: `src/app/api/admin/payments/[id]/refund/route.ts`
- Test: `tests/integration/admin/payment-refund.test.ts`

**Interfaces:**

- Consumes: same as Task 5 plus the state machine's `REFUND_PENDING` status. The admin endpoint only _enters_ the refund branch: it transitions the payment to `REFUND_PENDING`, records a `PaymentEvent`, and enqueues the worker — the Phase-5 worker `settlePayment` job owns `REFUND_PENDING → (return XLM to payer wallet via `walletService`) → REFUNDED`.
- Produces: `refundPayment({ id, actorId, ip }) => { id, status }`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/admin/payment-refund.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/admin/payments/[id]/refund/route";
import { prisma } from "@/server/db";
import { dec } from "@/lib/money";
import * as queues from "@/server/queue/queues";
import { asAdmin, makeRequest, seedPayment, resetDb } from "../helpers";

describe("POST /api/admin/payments/[id]/refund", () => {
  beforeEach(async () => {
    await resetDb();
    vi.restoreAllMocks();
  });

  it("transitions a STELLAR_CONFIRMED payment to REFUND_PENDING, records the event, enqueues the worker, and audits", async () => {
    const admin = await asAdmin();
    const spy = vi.spyOn(queues, "enqueueSettle").mockResolvedValue();
    const p = await seedPayment({ status: "STELLAR_CONFIRMED", amountXlm: dec("10.0000000") });
    const res = await POST(makeRequest("POST", `/api/admin/payments/${p.id}/refund`, {}), {
      params: Promise.resolve({ id: p.id }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("REFUND_PENDING");
    const updated = await prisma.payment.findUnique({ where: { id: p.id } });
    expect(updated!.status).toBe("REFUND_PENDING");
    const event = await prisma.paymentEvent.findFirst({
      where: { paymentId: p.id, toStatus: "REFUND_PENDING" },
    });
    expect(event).not.toBeNull();
    expect(spy).toHaveBeenCalledWith(p.id);
    const log = await prisma.auditLog.findFirst({
      where: { action: "admin.payment.refund", target: p.id },
    });
    expect(log?.actorId).toBe(admin.id);
  });

  it("409s when XLM never left the wallet (status CREATED/QUOTED/AUTHORIZED)", async () => {
    await asAdmin();
    vi.spyOn(queues, "enqueueSettle").mockResolvedValue();
    const p = await seedPayment({ status: "AUTHORIZED" });
    const res = await POST(makeRequest("POST", `/api/admin/payments/${p.id}/refund`, {}), {
      params: Promise.resolve({ id: p.id }),
    });
    expect(res.status).toBe(409);
  });

  it("409s when already REFUNDED", async () => {
    await asAdmin();
    vi.spyOn(queues, "enqueueSettle").mockResolvedValue();
    const p = await seedPayment({ status: "REFUNDED" });
    const res = await POST(makeRequest("POST", `/api/admin/payments/${p.id}/refund`, {}), {
      params: Promise.resolve({ id: p.id }),
    });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/admin/payment-refund.test.ts`
Expected: FAIL — refund route module not found.

- [ ] **Step 3: Add `refundPayment` to `src/server/admin/payments.ts`**

```typescript
// append to src/server/admin/payments.ts
// Refund only makes sense once XLM has actually left the custodial wallet (>= STELLAR_SUBMITTED)
// and the payment has not already reached a terminal refund/settled state.
const REFUNDABLE: PaymentStatus[] = [
  "STELLAR_SUBMITTED",
  "STELLAR_CONFIRMED",
  "PDAX_TRADING",
  "PDAX_TRADED",
  "PAYOUT_SUBMITTED",
  "FAILED",
];

export async function refundPayment(input: {
  id: string;
  actorId: string;
  ip?: string;
}): Promise<{ id: string; status: PaymentStatus }> {
  const p = await prisma.payment.findUnique({
    where: { id: input.id },
    select: { id: true, status: true },
  });
  if (!p) throw notFound("Payment not found");
  if (!REFUNDABLE.includes(p.status)) {
    throw conflict(`Cannot refund a ${p.status} payment`, { status: p.status });
  }
  await prisma.$transaction([
    prisma.payment.update({
      where: { id: p.id },
      data: { status: "REFUND_PENDING", failureReason: "Admin-initiated refund" },
    }),
    prisma.paymentEvent.create({
      data: {
        paymentId: p.id,
        fromStatus: p.status,
        toStatus: "REFUND_PENDING",
        detail: { action: "admin.refund", actorId: input.actorId },
      },
    }),
  ]);
  await enqueueSettle(p.id); // worker REFUND_PENDING branch returns XLM to payer, then -> REFUNDED
  await audit({
    actorId: input.actorId,
    action: "admin.payment.refund",
    target: p.id,
    metadata: { fromStatus: p.status },
    ip: input.ip,
  });
  return { id: p.id, status: "REFUND_PENDING" };
}
```

- [ ] **Step 4: Write `src/app/api/admin/payments/[id]/refund/route.ts`**

```typescript
import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { refundPayment } from "@/server/admin/payments";

export const POST = route(async (req, ctx) => {
  assertSameOrigin(req);
  const admin = await requireRole("ADMIN");
  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const result = await refundPayment({ id: ctx.params.id, actorId: admin.id, ip });
  return json(result);
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/admin/payment-refund.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 6: Commit**

```bash
git add src/server/admin/payments.ts "src/app/api/admin/payments/[id]/refund/route.ts" tests/integration/admin/payment-refund.test.ts
git commit -m "feat(admin): manual refund transitions to REFUND_PENDING + enqueues worker (audited)"
```

---

## Task 7: Health API — deep (`GET /api/admin/health`) + public shallow (`GET /api/health`)

**Files:**

- Create: `src/server/admin/health.ts`
- Create: `src/app/api/admin/health/route.ts`
- Create: `src/app/api/health/route.ts`
- Test: `tests/integration/admin/health.test.ts`

**Interfaces:**

- Consumes: `redis` (`@/server/redis`); `walletService` (`@/server/stellar/wallet`); `QUEUE_NAMES` (`@/server/queue/queues`); `route`, `json`; `requireRole`. Reads env `STELLAR_HORIZON_URL`, `PAYMENT_RAIL`.
- Produces: `checkHealth() => SystemHealth`, `shallowHealth()`, `ComponentHealth`, `SystemHealth`.

> **Note on PDAX/Stellar checks:** keep them cheap and bounded. Stellar = a `fetch(${STELLAR_HORIZON_URL})` with a 3s `AbortController` timeout. PDAX = when `PAYMENT_RAIL=mock` report `ok` (`detail: "mock rail"`); when `pdax`, ping `PDAX_BASE_URL` root with a 3s timeout (no signing — connectivity only). Redis = `redis.ping()`. Queue depth = a short-lived BullMQ `Queue(QUEUE_NAMES.settle)` `getJobCounts()`; sum `waiting + active + delayed`. Use `Promise.allSettled`; one failed component ⇒ overall `degraded`, all critical down ⇒ `down`. Never throw a provider's raw error to the client.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/integration/admin/health.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET as DEEP } from "@/app/api/admin/health/route";
import { GET as SHALLOW } from "@/app/api/health/route";
import { asAdmin, asPayer, makeRequest, resetDb } from "../helpers";

describe("admin health", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("reports a status per component", async () => {
    await asAdmin();
    const res = await DEEP(makeRequest("GET", "/api/admin/health"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.components.map((c: any) => c.name).sort();
    expect(names).toEqual(["pdax", "queue", "redis", "stellar"]);
    for (const c of body.components) expect(["ok", "degraded", "down"]).toContain(c.status);
    const queue = body.components.find((c: any) => c.name === "queue");
    expect(typeof queue.queueDepth).toBe("number");
  });

  it("requires ADMIN for the deep check", async () => {
    await asPayer();
    const res = await DEEP(makeRequest("GET", "/api/admin/health"), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(403);
  });

  it("public shallow check needs no auth and returns ok", async () => {
    const res = await SHALLOW(makeRequest("GET", "/api/health"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/integration/admin/health.test.ts`
Expected: FAIL — health modules not found.

- [ ] **Step 3: Write `src/server/admin/health.ts`**

```typescript
import "server-only";
import { Queue } from "bullmq";
import { redis } from "@/server/redis";
import { QUEUE_NAMES } from "@/server/queue/queues";

export type ComponentHealth = {
  name: "stellar" | "pdax" | "redis" | "queue";
  status: "ok" | "degraded" | "down";
  detail: string;
  latencyMs?: number;
  queueDepth?: number;
};
export type SystemHealth = {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  components: ComponentHealth[];
};

const START = Date.now();

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0 };
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, method: "GET" });
  } finally {
    clearTimeout(t);
  }
}

async function checkStellar(): Promise<ComponentHealth> {
  const url = process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
  try {
    const { value: res, ms } = await timed(() => fetchWithTimeout(url, 3000));
    return res.ok
      ? { name: "stellar", status: "ok", detail: `Horizon ${res.status}`, latencyMs: ms }
      : { name: "stellar", status: "degraded", detail: `Horizon ${res.status}`, latencyMs: ms };
  } catch {
    return { name: "stellar", status: "down", detail: "Horizon unreachable" };
  }
}

async function checkPdax(): Promise<ComponentHealth> {
  if ((process.env.PAYMENT_RAIL ?? "mock") === "mock") {
    return { name: "pdax", status: "ok", detail: "mock rail" };
  }
  const url = process.env.PDAX_BASE_URL ?? "";
  if (!url) return { name: "pdax", status: "down", detail: "PDAX_BASE_URL unset" };
  try {
    const { value: res, ms } = await timed(() => fetchWithTimeout(url, 3000));
    return {
      name: "pdax",
      status: res.status < 500 ? "ok" : "degraded",
      detail: `PDAX ${res.status}`,
      latencyMs: ms,
    };
  } catch {
    return { name: "pdax", status: "down", detail: "PDAX unreachable" };
  }
}

async function checkRedis(): Promise<ComponentHealth> {
  try {
    const { value: pong, ms } = await timed(() => redis.ping());
    return {
      name: "redis",
      status: pong === "PONG" ? "ok" : "degraded",
      detail: pong,
      latencyMs: ms,
    };
  } catch {
    return { name: "redis", status: "down", detail: "Redis unreachable" };
  }
}

async function checkQueue(): Promise<ComponentHealth> {
  const queue = new Queue(QUEUE_NAMES.settle, { connection: redis });
  try {
    const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
    const depth = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
    return {
      name: "queue",
      status: (counts.failed ?? 0) > 0 ? "degraded" : "ok",
      detail: `waiting ${counts.waiting ?? 0} · active ${counts.active ?? 0} · failed ${counts.failed ?? 0}`,
      queueDepth: depth,
    };
  } catch {
    return { name: "queue", status: "down", detail: "BullMQ unreachable", queueDepth: 0 };
  } finally {
    await queue.close();
  }
}

export async function checkHealth(): Promise<SystemHealth> {
  const components = await Promise.all([checkStellar(), checkPdax(), checkRedis(), checkQueue()]);
  const anyDown = components.some((c) => c.status === "down");
  const anyDegraded = components.some((c) => c.status === "degraded");
  const status: SystemHealth["status"] = anyDown ? "down" : anyDegraded ? "degraded" : "ok";
  return { status, checkedAt: new Date().toISOString(), components };
}

export async function shallowHealth(): Promise<{ status: "ok"; uptimeSec: number }> {
  return { status: "ok", uptimeSec: Math.round((Date.now() - START) / 1000) };
}
```

- [ ] **Step 4: Write `src/app/api/admin/health/route.ts`**

```typescript
import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { checkHealth } from "@/server/admin/health";

export const GET = route(async () => {
  await requireRole("ADMIN");
  const health = await checkHealth();
  // overall down maps to 503 for monitoring; degraded/ok return 200
  return json(health, health.status === "down" ? 503 : 200);
});
```

- [ ] **Step 5: Write `src/app/api/health/route.ts`** (public shallow, no auth — Railway probe)

```typescript
import { route, json } from "@/lib/http";
import { shallowHealth } from "@/server/admin/health";

// Intentionally NO requireRole — Railway/uptime probes hit this anonymously.
// Shallow: process liveness only, no external network calls, no data leak.
export const GET = route(async () => {
  return json(await shallowHealth());
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/integration/admin/health.test.ts`
Expected: PASS (mock rail ⇒ pdax ok; Redis up in test env ⇒ redis/queue ok).

- [ ] **Step 7: Commit**

```bash
git add src/server/admin/health.ts src/app/api/admin/health/route.ts src/app/api/health/route.ts tests/integration/admin/health.test.ts
git commit -m "feat(admin): deep health check API + public shallow /api/health for Railway"
```

---

## Task 8: Admin layout + SideNav + force-password-change gate

**Files:**

- Create: `src/components/admin/AdminSideNav.tsx`
- Create: `src/app/(admin)/layout.tsx`
- Create: `src/server/admin/gate.ts` (`adminMustChangePassword`)
- Test: `tests/components/admin/AdminSideNav.test.tsx`

**Interfaces:**

- Consumes: `getSessionUser` (`@/server/auth/sessions`); `prisma`; `redirect` (`next/navigation`).
- Produces: `<AdminSideNav active>`; `adminMustChangePassword(user) => Promise<boolean>`.

> **Force-password-change gate (AGENT §5):** there is no `mustChangePassword` column in the locked schema, so the gate is **flag-gated and derived**, not a schema change. In production (`NODE_ENV === "production"`) the seeded admin is required to change their password before using `/admin/*`. We detect "has changed password since seed" by the presence of an `AuditLog` row with `action === "auth.password.change"` for that admin (Phase 2's password endpoint writes this). If none exists in prod, redirect to `/admin/settings/password` (route owned by the auth/settings phase). Outside production the gate is disabled so local/demo admins are not blocked. This behavior is gated by `NODE_ENV` per SPEC's "first prod admin login".

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/admin/AdminSideNav.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AdminSideNav } from "@/components/admin/AdminSideNav";

describe("AdminSideNav", () => {
  it("renders every admin destination and marks the active one with aria-current", () => {
    render(<AdminSideNav active="payments" />);
    for (const label of ["Overview", "Users", "Merchants", "Payments", "Health"]) {
      expect(screen.getByRole("link", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: /payments/i })).toHaveAttribute("aria-current", "page");
  });

  it("uses rounded-lg data surfaces (no consumer pills) for nav items", () => {
    const { container } = render(<AdminSideNav active="overview" />);
    expect(container.querySelector(".rounded-lg")).toBeTruthy();
    expect(container.querySelector(".rounded-full")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/components/admin/AdminSideNav.test.tsx`
Expected: FAIL — `@/components/admin/AdminSideNav` not found.

- [ ] **Step 3: Write `src/components/admin/AdminSideNav.tsx`**

```tsx
import Link from "next/link";

type Key = "overview" | "users" | "merchants" | "payments" | "health";

const ITEMS: Array<{ key: Key; label: string; href: string; icon: string }> = [
  { key: "overview", label: "Overview", href: "/admin", icon: "dashboard" },
  { key: "users", label: "Users", href: "/admin/users", icon: "group" },
  { key: "merchants", label: "Merchants", href: "/admin/merchants", icon: "storefront" },
  { key: "payments", label: "Payments", href: "/admin/payments", icon: "payments" },
  { key: "health", label: "Health", href: "/admin/health", icon: "monitor_heart" },
];

export function AdminSideNav({ active }: { active: Key }) {
  return (
    <nav
      aria-label="Admin"
      className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-surface-container-low p-stack-md lg:flex"
    >
      <div className="flex items-center gap-stack-sm px-stack-sm py-stack-md">
        <span className="material-symbols-outlined icon-filled text-primary">
          account_balance_wallet
        </span>
        <span className="font-display text-headline-md font-bold text-primary">HeyPay</span>
        <span className="ml-stack-sm rounded-lg bg-surface-container-high px-2 py-0.5 text-label-md uppercase text-on-surface-variant">
          Admin
        </span>
      </div>
      <ul className="mt-stack-md flex flex-1 flex-col gap-1">
        {ITEMS.map((item) => {
          const isActive = item.key === active;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`flex items-center gap-stack-md rounded-lg px-stack-md py-3 text-body-md transition-colors ${
                  isActive
                    ? "bg-primary-container font-semibold text-on-primary-container"
                    : "text-on-surface-variant hover:bg-surface-container-high"
                }`}
              >
                <span className={`material-symbols-outlined ${isActive ? "icon-filled" : ""}`}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        href="/logout"
        className="mt-stack-md flex items-center gap-stack-md rounded-lg px-stack-md py-3 text-body-md text-error hover:bg-surface-container-high"
      >
        <span className="material-symbols-outlined">logout</span>
        Logout
      </Link>
    </nav>
  );
}
```

- [ ] **Step 4: Write `src/server/admin/gate.ts`**

```typescript
import "server-only";
import { prisma } from "@/server/db";

// AGENT §5: in production the seeded admin must change their password before using the console.
// Derived from AuditLog (no schema change). Disabled outside production.
export async function adminMustChangePassword(userId: string): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return false;
  const changed = await prisma.auditLog.findFirst({
    where: { actorId: userId, action: "auth.password.change" },
    select: { id: true },
  });
  return changed === null;
}
```

- [ ] **Step 5: Write `src/app/(admin)/layout.tsx`**

```tsx
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/sessions";
import { adminMustChangePassword } from "@/server/admin/gate";
import { AdminSideNav } from "@/components/admin/AdminSideNav";

export default async function AdminLayout({
  children,
  active,
}: {
  children: ReactNode;
  active?: "overview" | "users" | "merchants" | "payments" | "health";
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/403");
  if (await adminMustChangePassword(user.id)) redirect("/admin/settings/password");

  return (
    <div className="min-h-screen bg-background">
      <AdminSideNav active={active ?? "overview"} />
      <main className="px-margin-mobile py-stack-lg lg:ml-64 lg:px-margin-desktop">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
```

> Each page sets its own `active` by rendering its content directly; since Next layouts can't receive per-page props, pages render `<AdminSideNav active="...">` is **not** how layouts work — instead the layout renders the nav once and each page passes nothing. To get the correct active item without prop drilling, the layout reads it from the pathname. Replace the `active` prop wiring above with a client `usePathname()` inside `AdminSideNav` if preferred; for the plan, the layout determines `active` from `headers()`/route segment. **Implementer note:** simplest correct approach — make `AdminSideNav` a client component using `usePathname()` and drop the `active` prop from the layout. Keep the test by also accepting an optional `active` override prop (test passes it explicitly; runtime derives from pathname when omitted).

- [ ] **Step 6: Adjust `AdminSideNav` to derive active from pathname (keep test passing)**

```tsx
// top of src/components/admin/AdminSideNav.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
// ...ITEMS unchanged...

export function AdminSideNav({ active }: { active?: Key }) {
  const pathname = usePathname();
  const derived: Key =
    active ??
    (pathname === "/admin"
      ? "overview"
      : (ITEMS.find((i) => i.href !== "/admin" && pathname?.startsWith(i.href))?.key ??
        "overview"));
  // ...render uses `derived` in place of `active`...
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run tests/components/admin/AdminSideNav.test.tsx`
Expected: PASS (explicit `active="payments"` honored; default derives from pathname).

- [ ] **Step 8: Commit**

```bash
git add src/components/admin/AdminSideNav.tsx "src/app/(admin)/layout.tsx" src/server/admin/gate.ts tests/components/admin/AdminSideNav.test.tsx
git commit -m "feat(admin): admin layout, side nav, prod force-password-change gate"
```

---

## Task 9: `/admin` overview page

**Files:**

- Create: `src/components/admin/StatCard.tsx`
- Create: `src/app/(admin)/admin/page.tsx`
- Test: `tests/components/admin/StatCard.test.tsx`

**Interfaces:**

- Consumes: `getOverview()` (`@/server/admin/overview`); `displayXlm`, `displayPhp` (`@/lib/money`); `<StatBadge>`; `<AdminSideNav>` via layout.
- Produces: `<StatCard>`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/admin/StatCard.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StatCard } from "@/components/admin/StatCard";

describe("StatCard", () => {
  it("renders label, value, and uses a rounded-lg data surface", () => {
    const { container } = render(<StatCard label="Total Payments" value="1,204" icon="payments" />);
    expect(screen.getByText("Total Payments")).toBeInTheDocument();
    expect(screen.getByText("1,204")).toBeInTheDocument();
    expect(container.querySelector(".rounded-lg")).toBeTruthy();
    expect(container.querySelector(".rounded-full")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/components/admin/StatCard.test.tsx`
Expected: FAIL — `@/components/admin/StatCard` not found.

- [ ] **Step 3: Write `src/components/admin/StatCard.tsx`**

```tsx
export function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: string;
}) {
  return (
    <div className="tonal-card rounded-lg p-stack-lg">
      <div className="flex items-center justify-between">
        <span className="text-label-md uppercase text-on-surface-variant">{label}</span>
        <span className="material-symbols-outlined text-primary" aria-hidden="true">
          {icon}
        </span>
      </div>
      <p className="mt-stack-sm font-display text-headline-lg text-on-surface">{value}</p>
      {sub ? <p className="mt-1 font-mono text-mono-data text-on-surface-variant">{sub}</p> : null}
    </div>
  );
}
```

- [ ] **Step 4: Write `src/app/(admin)/admin/page.tsx`**

```tsx
import { getOverview } from "@/server/admin/overview";
import { displayXlm, displayPhp } from "@/lib/money";
import { StatCard } from "@/components/admin/StatCard";
import { StatBadge } from "@/components/admin/StatBadge";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const o = await getOverview();
  return (
    <section aria-labelledby="admin-overview-heading">
      <h1
        id="admin-overview-heading"
        className="font-display text-headline-lg-mobile text-on-surface lg:text-headline-lg"
      >
        System Overview
      </h1>

      <div className="mt-stack-lg grid grid-cols-1 gap-stack-lg sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Users"
          value={o.counts.users.toLocaleString()}
          sub={`${o.counts.payers} payers`}
          icon="group"
        />
        <StatCard
          label="Merchants"
          value={o.counts.merchants.toLocaleString()}
          sub={`${o.counts.activeMerchants} active`}
          icon="storefront"
        />
        <StatCard
          label="Payments"
          value={o.counts.payments.toLocaleString()}
          sub={`${o.counts.settledPayments} settled · ${o.counts.failedPayments} failed`}
          icon="payments"
        />
        <StatCard label="Settled Volume (XLM)" value={displayXlm(o.volume.totalXlm)} icon="star" />
        <StatCard
          label="Settled Volume (PHP)"
          value={displayPhp(o.volume.totalPhpSettled)}
          icon="trending_up"
        />
      </div>

      <div className="mt-stack-lg tonal-card rounded-lg p-stack-lg">
        <h2 className="font-display text-headline-md text-on-surface">Recent Failures</h2>
        {o.recentFailures.length === 0 ? (
          <p className="mt-stack-md text-body-md text-on-surface-variant">No failed payments. 🎉</p>
        ) : (
          <table className="mt-stack-md w-full text-left">
            <thead>
              <tr className="bg-surface-container-low">
                <th className="px-stack-md py-3 text-label-md uppercase text-outline">Reference</th>
                <th className="px-stack-md py-3 text-label-md uppercase text-outline">Merchant</th>
                <th className="px-stack-md py-3 text-label-md uppercase text-outline">Amount</th>
                <th className="px-stack-md py-3 text-label-md uppercase text-outline">Reason</th>
                <th className="px-stack-md py-3 text-label-md uppercase text-outline">Status</th>
              </tr>
            </thead>
            <tbody>
              {o.recentFailures.map((f) => (
                <tr key={f.id} className="border-t border-outline-variant">
                  <td className="px-stack-md py-3 font-mono text-mono-data text-on-surface">
                    {f.reference}
                  </td>
                  <td className="px-stack-md py-3 text-body-md text-on-surface">
                    {f.merchantName}
                  </td>
                  <td className="px-stack-md py-3 font-mono text-mono-data text-on-surface">
                    {displayPhp(f.amountPhp)}
                  </td>
                  <td className="px-stack-md py-3 text-body-sm text-on-surface-variant">
                    {f.failureReason ?? "—"}
                  </td>
                  <td className="px-stack-md py-3">
                    <StatBadge tone="error">Failed</StatBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/components/admin/StatCard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/StatCard.tsx "src/app/(admin)/admin/page.tsx" tests/components/admin/StatCard.test.tsx
git commit -m "feat(admin): /admin overview page (counts, volume, recent failures)"
```

---

## Task 10: `/admin/users` page (search, deactivate toggle, cursor pagination)

**Files:**

- Create: `src/components/admin/UserActiveToggle.tsx`
- Create: `src/app/(admin)/admin/users/page.tsx`
- Test: `tests/components/admin/UserActiveToggle.test.tsx`

**Interfaces:**

- Consumes: `listUsers()` (`@/server/admin/users`); `PATCH /api/admin/users/[id]`; `<StatBadge>`.
- Produces: `<UserActiveToggle id isActive>`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/admin/UserActiveToggle.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserActiveToggle } from "@/components/admin/UserActiveToggle";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ isActive: false }), { status: 200 })),
  );
});

describe("UserActiveToggle", () => {
  it("PATCHes the user with same-origin credentials and flips the label", async () => {
    render(<UserActiveToggle id="u1" isActive={true} username="alice" />);
    fireEvent.click(screen.getByRole("button", { name: /deactivate/i }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/users/u1",
        expect.objectContaining({ method: "PATCH", credentials: "same-origin" }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /activate/i })).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/components/admin/UserActiveToggle.test.tsx`
Expected: FAIL — `@/components/admin/UserActiveToggle` not found.

- [ ] **Step 3: Write `src/components/admin/UserActiveToggle.tsx`**

```tsx
"use client";
import { useState, useTransition } from "react";

export function UserActiveToggle({
  id,
  isActive,
  username,
}: {
  id: string;
  isActive: boolean;
  username: string;
}) {
  const [active, setActive] = useState(isActive);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    setError(null);
    start(async () => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !active }),
      });
      if (!res.ok) {
        setError("Update failed");
        return;
      }
      const body = await res.json();
      setActive(body.isActive);
    });
  }

  return (
    <div className="flex items-center gap-stack-sm">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-label={`${active ? "Deactivate" : "Activate"} ${username}`}
        className={`rounded-lg px-stack-md py-2 text-label-md uppercase disabled:opacity-50 ${
          active
            ? "bg-error/10 text-error hover:bg-error/20"
            : "bg-primary/10 text-primary hover:bg-primary/20"
        }`}
      >
        {active ? "Deactivate" : "Activate"}
      </button>
      {error ? (
        <span className="text-body-sm text-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Write `src/app/(admin)/admin/users/page.tsx`**

```tsx
import Link from "next/link";
import { listUsers } from "@/server/admin/users";
import { StatBadge } from "@/components/admin/StatBadge";
import { UserActiveToggle } from "@/components/admin/UserActiveToggle";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const sp = await searchParams;
  const page = await listUsers({ q: sp.q, cursor: sp.cursor, limit: 20 });

  return (
    <section aria-labelledby="admin-users-heading">
      <h1
        id="admin-users-heading"
        className="font-display text-headline-lg-mobile text-on-surface lg:text-headline-lg"
      >
        Users
      </h1>

      <form className="mt-stack-lg flex gap-stack-sm" role="search" action="/admin/users">
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search username"
          aria-label="Search users"
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md py-2 text-body-md focus:ring-4 focus:ring-primary/10"
        />
        <button type="submit" className="rounded-lg bg-primary px-stack-lg py-2 text-on-primary">
          Search
        </button>
      </form>

      <div className="mt-stack-lg overflow-x-auto tonal-card rounded-lg">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-surface-container-low">
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Username</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Role</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Status</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Created</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Action</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((u) => (
              <tr key={u.id} className="border-t border-outline-variant">
                <td className="px-stack-md py-3 text-body-md text-on-surface">{u.username}</td>
                <td className="px-stack-md py-3 text-label-md uppercase text-on-surface-variant">
                  {u.role}
                </td>
                <td className="px-stack-md py-3">
                  {u.isActive ? (
                    <StatBadge tone="settled">Active</StatBadge>
                  ) : (
                    <StatBadge tone="error">Inactive</StatBadge>
                  )}
                </td>
                <td className="px-stack-md py-3 font-mono text-mono-data text-on-surface-variant">
                  {u.createdAt.toISOString().slice(0, 10)}
                </td>
                <td className="px-stack-md py-3">
                  <UserActiveToggle id={u.id} isActive={u.isActive} username={u.username} />
                </td>
              </tr>
            ))}
            {page.items.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-stack-md py-stack-lg text-center text-body-md text-on-surface-variant"
                >
                  No users found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {page.nextCursor ? (
        <div className="mt-stack-lg flex justify-end">
          <Link
            href={`/admin/users?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), cursor: page.nextCursor }).toString()}`}
            className="rounded-lg border border-outline-variant px-stack-lg py-2 text-body-md text-primary hover:bg-surface-container-high"
          >
            Next page
          </Link>
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/components/admin/UserActiveToggle.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/UserActiveToggle.tsx "src/app/(admin)/admin/users/page.tsx" tests/components/admin/UserActiveToggle.test.tsx
git commit -m "feat(admin): /admin/users list, search, deactivate, cursor pagination"
```

---

## Task 11: `/admin/merchants` page (review/activate/suspend with status badges)

**Files:**

- Create: `src/components/admin/MerchantStatusControl.tsx`
- Create: `src/app/(admin)/admin/merchants/page.tsx`
- Test: `tests/components/admin/MerchantStatusControl.test.tsx`

**Interfaces:**

- Consumes: `listAdminMerchants()` (`@/server/admin/merchants`); `MerchantStatus`; `PATCH /api/admin/merchants/[id]`; `<StatBadge>`.
- Produces: `<MerchantStatusControl id status>`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/admin/MerchantStatusControl.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MerchantStatusControl } from "@/components/admin/MerchantStatusControl";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ status: "ACTIVE" }), { status: 200 })),
  );
});

describe("MerchantStatusControl", () => {
  it("activates a PENDING_REVIEW merchant via PATCH and reflects the new badge", async () => {
    render(<MerchantStatusControl id="m1" status="PENDING_REVIEW" />);
    fireEvent.click(screen.getByRole("button", { name: /activate/i }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/merchants/m1",
        expect.objectContaining({ method: "PATCH", credentials: "same-origin" }),
      ),
    );
    await waitFor(() => expect(screen.getByText(/active/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/components/admin/MerchantStatusControl.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/components/admin/MerchantStatusControl.tsx`**

```tsx
"use client";
import { useState, useTransition } from "react";
import type { MerchantStatus } from "@/generated/prisma";
import { StatBadge } from "@/components/admin/StatBadge";

const TONE: Record<MerchantStatus, "settled" | "pending" | "error" | "neutral"> = {
  ACTIVE: "settled",
  PENDING_REVIEW: "pending",
  SUSPENDED: "error",
  DRAFT: "neutral",
};
const LABEL: Record<MerchantStatus, string> = {
  ACTIVE: "Active",
  PENDING_REVIEW: "Pending Review",
  SUSPENDED: "Suspended",
  DRAFT: "Draft",
};

export function MerchantStatusControl({ id, status }: { id: string; status: MerchantStatus }) {
  const [current, setCurrent] = useState<MerchantStatus>(status);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(next: MerchantStatus) {
    setError(null);
    start(async () => {
      const res = await fetch(`/api/admin/merchants/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setError("Update failed");
        return;
      }
      const body = await res.json();
      setCurrent(body.status as MerchantStatus);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-stack-sm">
      <StatBadge tone={TONE[current]}>{LABEL[current]}</StatBadge>
      {current !== "ACTIVE" ? (
        <button
          type="button"
          onClick={() => change("ACTIVE")}
          disabled={pending}
          className="rounded-lg bg-primary/10 px-stack-md py-2 text-label-md uppercase text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          Activate
        </button>
      ) : null}
      {current !== "SUSPENDED" ? (
        <button
          type="button"
          onClick={() => change("SUSPENDED")}
          disabled={pending}
          className="rounded-lg bg-error/10 px-stack-md py-2 text-label-md uppercase text-error hover:bg-error/20 disabled:opacity-50"
        >
          Suspend
        </button>
      ) : null}
      {error ? (
        <span role="alert" className="text-body-sm text-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Write `src/app/(admin)/admin/merchants/page.tsx`**

```tsx
import Link from "next/link";
import { listAdminMerchants } from "@/server/admin/merchants";
import { MerchantStatus } from "@/generated/prisma";
import { MerchantStatusControl } from "@/components/admin/MerchantStatusControl";

export const dynamic = "force-dynamic";

export default async function AdminMerchantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; cursor?: string }>;
}) {
  const sp = await searchParams;
  const status =
    sp.status && sp.status in MerchantStatus ? (sp.status as MerchantStatus) : undefined;
  const page = await listAdminMerchants({ q: sp.q, status, cursor: sp.cursor, limit: 20 });

  return (
    <section aria-labelledby="admin-merchants-heading">
      <h1
        id="admin-merchants-heading"
        className="font-display text-headline-lg-mobile text-on-surface lg:text-headline-lg"
      >
        Merchants
      </h1>

      <form
        className="mt-stack-lg flex flex-wrap gap-stack-sm"
        role="search"
        action="/admin/merchants"
      >
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search business name"
          aria-label="Search merchants"
          className="flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md py-2 text-body-md focus:ring-4 focus:ring-primary/10"
        />
        <select
          name="status"
          defaultValue={sp.status ?? ""}
          aria-label="Filter by status"
          className="rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md py-2 text-body-md"
        >
          <option value="">All statuses</option>
          {Object.values(MerchantStatus).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-primary px-stack-lg py-2 text-on-primary">
          Filter
        </button>
      </form>

      <div className="mt-stack-lg overflow-x-auto tonal-card rounded-lg">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-surface-container-low">
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Business</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Owner</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Settlement</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">
                Status / Action
              </th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((m) => (
              <tr key={m.id} className="border-t border-outline-variant">
                <td className="px-stack-md py-3 text-body-md text-on-surface">{m.businessName}</td>
                <td className="px-stack-md py-3 text-body-md text-on-surface-variant">
                  {m.username}
                </td>
                <td className="px-stack-md py-3 font-mono text-mono-data text-on-surface-variant">
                  {m.settlementBankName} ····{m.accountNumberLast4}
                </td>
                <td className="px-stack-md py-3">
                  <MerchantStatusControl id={m.id} status={m.status} />
                </td>
              </tr>
            ))}
            {page.items.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-stack-md py-stack-lg text-center text-body-md text-on-surface-variant"
                >
                  No merchants found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {page.nextCursor ? (
        <div className="mt-stack-lg flex justify-end">
          <Link
            href={`/admin/merchants?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}), cursor: page.nextCursor }).toString()}`}
            className="rounded-lg border border-outline-variant px-stack-lg py-2 text-body-md text-primary hover:bg-surface-container-high"
          >
            Next page
          </Link>
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/components/admin/MerchantStatusControl.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/MerchantStatusControl.tsx "src/app/(admin)/admin/merchants/page.tsx" tests/components/admin/MerchantStatusControl.test.tsx
git commit -m "feat(admin): /admin/merchants review/activate/suspend with status badges"
```

---

## Task 12: `/admin/payments` page (table + state timeline + retry/refund confirm dialogs)

**Files:**

- Create: `src/components/admin/ConfirmDialog.tsx`
- Create: `src/components/admin/PaymentRow.tsx`
- Create: `src/app/(admin)/admin/payments/page.tsx`
- Test: `tests/components/admin/PaymentRow.test.tsx`

**Interfaces:**

- Consumes: `listAdminPayments()`, `getAdminPayment()` (`@/server/admin/payments`); `PaymentStatus`; `POST /api/admin/payments/[id]/retry`, `.../refund`; `GET /api/admin/payments/[id]`; `<StatBadge>`.
- Produces: `<ConfirmDialog>`, `<PaymentRow row>`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/admin/PaymentRow.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaymentRow } from "@/components/admin/PaymentRow";

const row = {
  id: "p1",
  reference: "TXN-ABCD1234",
  status: "FAILED" as const,
  payerUsername: "alice",
  merchantName: "Sari Store",
  amountPhp: "100.00",
  amountXlm: "10.0000000",
  failureReason: "PDAX timeout",
  createdAt: "2026-06-28T00:00:00.000Z",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/retry"))
        return new Response(JSON.stringify({ status: "FAILED" }), { status: 200 });
      return new Response(
        JSON.stringify({
          ...row,
          events: [
            {
              id: "e1",
              fromStatus: "AUTHORIZED",
              toStatus: "STELLAR_SUBMITTED",
              detail: null,
              createdAt: "2026-06-28T00:00:01.000Z",
            },
            {
              id: "e2",
              fromStatus: "STELLAR_SUBMITTED",
              toStatus: "FAILED",
              detail: { reason: "PDAX timeout" },
              createdAt: "2026-06-28T00:00:02.000Z",
            },
          ],
          stellarTxHash: null,
          pdaxTradeRef: null,
          pdaxCashoutRef: null,
        }),
        { status: 200 },
      );
    }),
  );
});

describe("PaymentRow", () => {
  it("expands to load the event timeline", async () => {
    render(
      <table>
        <tbody>
          <PaymentRow row={row} />
        </tbody>
      </table>,
    );
    fireEvent.click(screen.getByRole("button", { name: /view timeline/i }));
    await waitFor(() => expect(screen.getByText(/STELLAR_SUBMITTED/)).toBeInTheDocument());
    expect(screen.getByText(/PDAX timeout/)).toBeInTheDocument();
  });

  it("retry asks for confirmation then POSTs", async () => {
    render(
      <table>
        <tbody>
          <PaymentRow row={row} />
        </tbody>
      </table>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/payments/p1/retry",
        expect.objectContaining({ method: "POST", credentials: "same-origin" }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/components/admin/PaymentRow.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/components/admin/ConfirmDialog.tsx`**

```tsx
"use client";
import { useEffect, useRef } from "react";

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = "primary",
  onConfirm,
  onCancel,
  pending,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  tone?: "primary" | "error";
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-on-surface/40 p-stack-md"
    >
      <div className="w-full max-w-sm rounded-lg bg-surface-container-lowest p-stack-lg shadow-lg">
        <h2 className="font-display text-headline-md text-on-surface">{title}</h2>
        <p className="mt-stack-sm text-body-md text-on-surface-variant">{body}</p>
        <div className="mt-stack-lg flex justify-end gap-stack-sm">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-outline-variant px-stack-lg py-2 text-body-md text-on-surface hover:bg-surface-container-high disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            ref={ref}
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`rounded-lg px-stack-lg py-2 text-body-md disabled:opacity-50 ${
              tone === "error" ? "bg-error text-on-error" : "bg-primary text-on-primary"
            }`}
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `src/components/admin/PaymentRow.tsx`**

```tsx
"use client";
import { useState, useTransition } from "react";
import type { PaymentStatus } from "@/generated/prisma";
import { StatBadge } from "@/components/admin/StatBadge";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";

export type PaymentRowData = {
  id: string;
  reference: string;
  status: PaymentStatus;
  payerUsername: string;
  merchantName: string;
  amountPhp: string;
  amountXlm: string;
  failureReason: string | null;
  createdAt: string;
};
type EventItem = {
  id: string;
  fromStatus: PaymentStatus | null;
  toStatus: PaymentStatus;
  detail: unknown;
  createdAt: string;
};

function tone(status: PaymentStatus): "settled" | "pending" | "error" | "neutral" {
  if (status === "SETTLED") return "settled";
  if (status === "FAILED" || status === "REFUND_PENDING" || status === "REFUNDED") return "error";
  if (status === "CREATED") return "neutral";
  return "pending";
}

export function PaymentRow({ row }: { row: PaymentRowData }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [dialog, setDialog] = useState<null | "retry" | "refund">(null);
  const [status, setStatus] = useState<PaymentStatus>(row.status);
  const [pending, start] = useTransition();

  async function loadTimeline() {
    if (!open && !events) {
      const res = await fetch(`/api/admin/payments/${row.id}`, { credentials: "same-origin" });
      if (res.ok) setEvents((await res.json()).events as EventItem[]);
    }
    setOpen((v) => !v);
  }

  function act(kind: "retry" | "refund") {
    start(async () => {
      const res = await fetch(`/api/admin/payments/${row.id}/${kind}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (res.ok) setStatus((await res.json()).status as PaymentStatus);
      setDialog(null);
    });
  }

  return (
    <>
      <tr className="border-t border-outline-variant align-top">
        <td className="px-stack-md py-3 font-mono text-mono-data text-on-surface">
          {row.reference}
        </td>
        <td className="px-stack-md py-3 text-body-md text-on-surface">
          {row.payerUsername} → {row.merchantName}
        </td>
        <td className="px-stack-md py-3">
          <div className="font-mono text-mono-data font-semibold text-on-surface">
            {row.amountXlm} XLM
          </div>
          <div className="font-mono text-mono-data text-outline">₱{row.amountPhp}</div>
        </td>
        <td className="px-stack-md py-3">
          <StatBadge tone={tone(status)}>{status.replace(/_/g, " ")}</StatBadge>
        </td>
        <td className="px-stack-md py-3">
          <div className="flex flex-wrap gap-stack-sm">
            <button
              type="button"
              onClick={loadTimeline}
              aria-expanded={open}
              aria-label={`View timeline for ${row.reference}`}
              className="rounded-lg border border-outline-variant px-stack-md py-2 text-label-md uppercase text-on-surface hover:bg-surface-container-high"
            >
              {open ? "Hide" : "View timeline"}
            </button>
            <button
              type="button"
              onClick={() => setDialog("retry")}
              className="rounded-lg bg-primary/10 px-stack-md py-2 text-label-md uppercase text-primary hover:bg-primary/20"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => setDialog("refund")}
              className="rounded-lg bg-secondary/10 px-stack-md py-2 text-label-md uppercase text-secondary hover:bg-secondary/20"
            >
              Refund
            </button>
          </div>
        </td>
      </tr>
      {open && events ? (
        <tr className="border-t border-outline-variant bg-surface-container-low">
          <td colSpan={5} className="px-stack-md py-stack-md">
            <ol className="flex flex-col gap-stack-sm">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-stack-md">
                  <span className="material-symbols-outlined text-primary" aria-hidden="true">
                    check_circle
                  </span>
                  <span className="font-mono text-mono-data text-on-surface">
                    {e.fromStatus ? `${e.fromStatus} → ` : ""}
                    {e.toStatus}
                  </span>
                  <span className="font-mono text-mono-data text-outline">
                    {new Date(e.createdAt).toISOString().replace("T", " ").slice(0, 19)}
                  </span>
                  {e.detail ? (
                    <span className="text-body-sm text-on-surface-variant">
                      {JSON.stringify(e.detail)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </td>
        </tr>
      ) : null}

      <ConfirmDialog
        open={dialog === "retry"}
        tone="primary"
        pending={pending}
        title="Retry settlement"
        confirmLabel="Confirm retry"
        body={`Re-enqueue settlement for ${row.reference} from its current status?`}
        onCancel={() => setDialog(null)}
        onConfirm={() => act("retry")}
      />
      <ConfirmDialog
        open={dialog === "refund"}
        tone="error"
        pending={pending}
        title="Refund payment"
        confirmLabel="Confirm refund"
        body={`Return XLM to the payer for ${row.reference}? This sets the payment to REFUND_PENDING.`}
        onCancel={() => setDialog(null)}
        onConfirm={() => act("refund")}
      />
    </>
  );
}
```

- [ ] **Step 5: Write `src/app/(admin)/admin/payments/page.tsx`**

```tsx
import Link from "next/link";
import { listAdminPayments } from "@/server/admin/payments";
import { PaymentStatus } from "@/generated/prisma";
import { PaymentRow } from "@/components/admin/PaymentRow";

export const dynamic = "force-dynamic";

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; cursor?: string }>;
}) {
  const sp = await searchParams;
  const status = sp.status && sp.status in PaymentStatus ? (sp.status as PaymentStatus) : undefined;
  const page = await listAdminPayments({ q: sp.q, status, cursor: sp.cursor, limit: 20 });

  return (
    <section aria-labelledby="admin-payments-heading">
      <h1
        id="admin-payments-heading"
        className="font-display text-headline-lg-mobile text-on-surface lg:text-headline-lg"
      >
        Payments
      </h1>

      <form
        className="mt-stack-lg flex flex-wrap gap-stack-sm"
        role="search"
        action="/admin/payments"
      >
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search reference / payer / merchant"
          aria-label="Search payments"
          className="flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md py-2 text-body-md focus:ring-4 focus:ring-primary/10"
        />
        <select
          name="status"
          defaultValue={sp.status ?? ""}
          aria-label="Filter by status"
          className="rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md py-2 text-body-md"
        >
          <option value="">All statuses</option>
          {Object.values(PaymentStatus).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-primary px-stack-lg py-2 text-on-primary">
          Filter
        </button>
      </form>

      <div className="mt-stack-lg overflow-x-auto tonal-card rounded-lg">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-surface-container-low">
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Reference</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">
                Payer → Merchant
              </th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Amount</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Status</th>
              <th className="px-stack-md py-3 text-label-md uppercase text-outline">Actions</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((p) => (
              <PaymentRow key={p.id} row={{ ...p, createdAt: p.createdAt }} />
            ))}
            {page.items.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-stack-md py-stack-lg text-center text-body-md text-on-surface-variant"
                >
                  No payments found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {page.nextCursor ? (
        <div className="mt-stack-lg flex justify-end">
          <Link
            href={`/admin/payments?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}), cursor: page.nextCursor }).toString()}`}
            className="rounded-lg border border-outline-variant px-stack-lg py-2 text-body-md text-primary hover:bg-surface-container-high"
          >
            Next page
          </Link>
        </div>
      ) : null}
    </section>
  );
}
```

> **Note:** `listAdminPayments` returns `amountPhp`/`amountXlm`/`createdAt` as `Decimal`/`Date`. Since `<PaymentRow>` is a Client Component, the page serializes them: change the page's map to `row={{ ...p, amountPhp: p.amountPhp.toFixed(2), amountXlm: p.amountXlm.toFixed(7), createdAt: p.createdAt.toISOString() }}`. Apply this exact mapping when wiring the row.

- [ ] **Step 6: Apply the serialization mapping in the page**

```tsx
{
  page.items.map((p) => (
    <PaymentRow
      key={p.id}
      row={{
        id: p.id,
        reference: p.reference,
        status: p.status,
        payerUsername: p.payerUsername,
        merchantName: p.merchantName,
        amountPhp: p.amountPhp.toFixed(2),
        amountXlm: p.amountXlm.toFixed(7),
        failureReason: p.failureReason,
        createdAt: p.createdAt.toISOString(),
      }}
    />
  ));
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run tests/components/admin/PaymentRow.test.tsx`
Expected: PASS (timeline expansion + retry confirm POST).

- [ ] **Step 8: Commit**

```bash
git add src/components/admin/ConfirmDialog.tsx src/components/admin/PaymentRow.tsx "src/app/(admin)/admin/payments/page.tsx" tests/components/admin/PaymentRow.test.tsx
git commit -m "feat(admin): /admin/payments table, state timeline, retry/refund dialogs"
```

---

## Task 13: `/admin/health` page (connectivity tiles + queue depth, reduced-motion-safe auto-refresh)

**Files:**

- Create: `src/components/admin/HealthTiles.tsx`
- Create: `src/app/(admin)/admin/health/page.tsx`
- Test: `tests/components/admin/HealthTiles.test.tsx`

**Interfaces:**

- Consumes: `checkHealth()` (`@/server/admin/health`) for the initial SSR snapshot; `GET /api/admin/health` for refresh; `SystemHealth`, `ComponentHealth` types.
- Produces: `<HealthTiles initial>`.

> **Reduced motion:** the auto-refresh interval (10s) still runs, but the "refreshing" spinner must not animate when `prefers-reduced-motion: reduce` — gate the spinner class on a `matchMedia` check, and show a static "Updating…" text instead. No pulsing/spinning is rendered for reduced-motion users.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/components/admin/HealthTiles.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HealthTiles } from "@/components/admin/HealthTiles";

const initial = {
  status: "degraded" as const,
  checkedAt: "2026-06-28T00:00:00.000Z",
  components: [
    { name: "stellar" as const, status: "ok" as const, detail: "Horizon 200", latencyMs: 42 },
    { name: "pdax" as const, status: "ok" as const, detail: "mock rail" },
    { name: "redis" as const, status: "ok" as const, detail: "PONG", latencyMs: 1 },
    { name: "queue" as const, status: "degraded" as const, detail: "failed 2", queueDepth: 7 },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi
      .fn()
      .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(initial), { status: 200 })),
  );
});

describe("HealthTiles", () => {
  it("renders a tile per component with status and queue depth", () => {
    render(<HealthTiles initial={initial} />);
    expect(screen.getByText(/stellar/i)).toBeInTheDocument();
    expect(screen.getByText(/pdax/i)).toBeInTheDocument();
    expect(screen.getByText(/redis/i)).toBeInTheDocument();
    expect(screen.getByText(/queue/i)).toBeInTheDocument();
    expect(screen.getByText(/7/)).toBeInTheDocument(); // queue depth
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/components/admin/HealthTiles.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/components/admin/HealthTiles.tsx`**

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import type { SystemHealth } from "@/server/admin/health";
import { StatBadge } from "@/components/admin/StatBadge";

const TONE = { ok: "settled", degraded: "pending", down: "error" } as const;
const LABEL = { ok: "OK", degraded: "Degraded", down: "Down" } as const;
const ICON: Record<string, string> = {
  stellar: "star",
  pdax: "currency_exchange",
  redis: "memory",
  queue: "stacks",
};

export function HealthTiles({ initial }: { initial: SystemHealth }) {
  const [health, setHealth] = useState<SystemHealth>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = setInterval(async () => {
      setRefreshing(true);
      try {
        const res = await fetch("/api/admin/health", { credentials: "same-origin" });
        if (res.ok) setHealth(await res.json());
      } finally {
        setRefreshing(false);
      }
    }, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between">
        <StatBadge tone={TONE[health.status]}>{LABEL[health.status]}</StatBadge>
        <span
          className="flex items-center gap-stack-sm text-body-sm text-on-surface-variant"
          aria-live="polite"
        >
          {refreshing && !reduced.current ? (
            <span
              className="material-symbols-outlined animate-spin text-primary"
              aria-hidden="true"
            >
              sync
            </span>
          ) : null}
          {refreshing
            ? "Updating…"
            : `Checked ${new Date(health.checkedAt).toISOString().slice(11, 19)} UTC`}
        </span>
      </div>

      <div className="mt-stack-lg grid grid-cols-1 gap-stack-lg sm:grid-cols-2 lg:grid-cols-4">
        {health.components.map((c) => (
          <div key={c.name} className="tonal-card rounded-lg p-stack-lg">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-stack-sm font-display text-headline-md capitalize text-on-surface">
                <span className="material-symbols-outlined text-primary" aria-hidden="true">
                  {ICON[c.name]}
                </span>
                {c.name}
              </span>
              <StatBadge tone={TONE[c.status]}>{LABEL[c.status]}</StatBadge>
            </div>
            <p className="mt-stack-md font-mono text-mono-data text-on-surface-variant">
              {c.detail}
            </p>
            {typeof c.latencyMs === "number" ? (
              <p className="mt-1 font-mono text-mono-data text-outline">{c.latencyMs} ms</p>
            ) : null}
            {typeof c.queueDepth === "number" ? (
              <p className="mt-1 font-mono text-mono-data text-outline">
                Queue depth: {c.queueDepth}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `src/app/(admin)/admin/health/page.tsx`**

```tsx
import { checkHealth } from "@/server/admin/health";
import { HealthTiles } from "@/components/admin/HealthTiles";

export const dynamic = "force-dynamic";

export default async function AdminHealthPage() {
  const initial = await checkHealth();
  return (
    <section aria-labelledby="admin-health-heading">
      <h1
        id="admin-health-heading"
        className="font-display text-headline-lg-mobile text-on-surface lg:text-headline-lg"
      >
        System Health
      </h1>
      <div className="mt-stack-lg">
        <HealthTiles initial={initial} />
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/components/admin/HealthTiles.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full admin suite + typecheck**

Run: `pnpm vitest run tests/integration/admin tests/components/admin && pnpm typecheck`
Expected: all green, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/HealthTiles.tsx "src/app/(admin)/admin/health/page.tsx" tests/components/admin/HealthTiles.test.tsx
git commit -m "feat(admin): /admin/health connectivity tiles + queue depth + reduced-motion-safe auto-refresh"
```

---

## Self-Review

**1. Spec coverage — SPEC §5 admin routes:**

| SPEC §5 route                                                              | Task                          |
| -------------------------------------------------------------------------- | ----------------------------- |
| `/admin` (overview: counts, volume XLM/PHP, recent failures)               | Task 9 (page) + Task 1 (data) |
| `/admin/users` (list/search, deactivate)                                   | Task 10 + Task 2              |
| `/admin/merchants` (review/activate/suspend)                               | Task 11 + Task 3              |
| `/admin/payments` (all payments, full state timeline, manual retry/refund) | Task 12 + Tasks 4–6           |
| `/admin/health` (Stellar/PDAX/Redis connectivity, queue depth)             | Task 13 + Task 7              |
| Route group `(admin)` + `requireRole(ADMIN)` layout                        | Task 8                        |

**Spec coverage — SPEC §6 admin endpoints:**

| SPEC §6 endpoint                                                          | Task                     |
| ------------------------------------------------------------------------- | ------------------------ |
| `GET /api/admin/overview`                                                 | Task 1                   |
| `GET /api/admin/users`                                                    | Task 2                   |
| `PATCH /api/admin/users/[id]` (activate/deactivate)                       | Task 2                   |
| `GET /api/admin/merchants`                                                | Task 3                   |
| `PATCH /api/admin/merchants/[id]` (status)                                | Task 3                   |
| `GET /api/admin/payments` (+ cursor + filters)                            | Task 4                   |
| `GET /api/admin/payments/[id]` (detail + events)                          | Task 4                   |
| `POST /api/admin/payments/[id]/retry`                                     | Task 5                   |
| `POST /api/admin/payments/[id]/refund`                                    | Task 6                   |
| `GET /api/admin/health`                                                   | Task 7                   |
| All `role=ADMIN` + `route()` + `assertSameOrigin` (mutations) + `audit()` | Tasks 1–7 (each handler) |

**Spec coverage — SPEC §10 observability/health + AGENT §5/§6:**

- §10 health endpoint (component status + queue depth) → Task 7 (`checkHealth`) surfaced in Task 13; public Railway probe `GET /api/health` → Task 7 (`shallowHealth`), wired in AGENT §11 deployment.
- §10 `PaymentEvent` correlation / state timeline visible to operators → Task 4 (`getAdminPayment` returns ordered events) + Task 12 (timeline UI).
- AGENT §5 seeded admin force-password-change on first prod login → Task 8 (`adminMustChangePassword`, `NODE_ENV`-gated, derived from `AuditLog` — documented deviation: no schema column, uses existing model).
- AGENT §6 "admin override audited" → every mutation (`setUserActive`, `setMerchantStatus`, `retryPayment`, `refundPayment`) writes `AuditLog` with `actorId = admin.id`; verified by integration tests in Tasks 2, 3, 5, 6.
- AGENT §6 PII protection → admin lists exclude `passwordHash`/`encryptedSecret`/full account number (select lists + `accountNumberLast4` only); asserted in Tasks 2 & 3 tests.

**2. Placeholder scan:** No `TBD`/`TODO`/"implement later"/"add appropriate…" left. Every code step shows complete content. The two "Note" callouts (Task 8 nav-active wiring, Task 12 Decimal serialization) are followed by an explicit corrective step (Task 8 Step 6, Task 12 Step 6) with the exact final code — not deferrals. No references to undefined symbols: all consumed names (`route`, `json`, `parseQuery`, `parseBody`, `requireRole`, `assertSameOrigin`, `audit`, `prisma`, `redis`, `enqueueSettle`, `QUEUE_NAMES`, `walletService`, `rail`, `dec`, `Decimal`, `displayXlm`, `displayPhp`, `badRequest`/`notFound`/`conflict`/`forbidden`) come from the overview's Locked Shared Contracts.

**3. Type/signature consistency:**

- `enqueueSettle(paymentId: string)` — used verbatim in Tasks 5 & 6 (matches overview `queue/queues.ts`).
- State machine — admin only _enters_ transitions (`retry` re-enqueues current status; `refund` writes a `REFUND_PENDING` `PaymentEvent` + enqueues); the Phase-5 worker owns `REFUND_PENDING → REFUNDED` and the resumable per-status settlement (matches overview "Settlement State Machine" + §8.4 refund branch). No invented state-machine function is consumed — only `enqueueSettle` + `prisma` writes.
- `audit({ actorId, action, target?, metadata?, ip? })` — every call matches the overview `audit.ts` signature (best-effort, never throws into request path).
- `Page<T>`/`encodeCursor`/`decodeCursor`/`listQuerySchema` defined once (Task 1) and reused identically in Tasks 2, 3, 4.
- `AdminPaymentRow`/`AdminPaymentDetail`/`AdminPaymentEvent` defined in Task 4 and consumed unchanged in Tasks 5, 6, 12.
- `StatBadge` `tone` union (`settled|pending|error|neutral`) is identical across `StatBadge` (Task 1), `MerchantStatusControl` (Task 11), and `PaymentRow` (Task 12).
- Money never crosses the wire as `Decimal`: handlers `toFixed`/`displayXlm`/`displayPhp`, Client Components receive strings (Tasks 1, 4, 12). Server Components call services directly and format with `displayXlm`/`displayPhp` (Tasks 9, 13).
- BRAND compliance: all admin surfaces use `rounded-lg` (asserted absent-`rounded-full` in Tasks 8 & 9 tests); status via badge+dot text; `mono-data` for all amounts/refs/hashes; reduced-motion-safe health refresh (Task 13).
