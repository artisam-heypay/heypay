# Phase 7: Merchant UI & API — HeyPay

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is the Phase 7 detail plan; read `2026-06-28-heypay-00-overview.md` first — its **Global Constraints** and **Locked Shared Contracts** apply to every task here verbatim.

**Goal:** Ship the complete MERCHANT surface — merchant API route handlers (create → settlement → QRPH → go-live, transactions, earnings, business QR) plus the themed merchant UI (onboarding wizard with live payer preview, dashboard, settlement history with CSV export, business QR, settings).

**Depends on: Phases 1–5** (money/errors/http/db from 1; `requireRole`/`assertSameOrigin`/`audit`/sessions from 2; `encryptSecret`, `decodeQrph`, `resolveMerchant`, `presignUpload`/`verifyUploadedObject`/`signedGetUrl` from 3; `Payment`/`Merchant` rows + state machine from 5).

**Deliverable:** A MERCHANT user can sign up, complete the 4-step onboarding wizard, go live, and view earnings, settlement history (with CSV export), their business QR, and edit settings — all behind ownership-checked, Zod-validated, same-origin APIs and themed strictly with BRAND tokens.

## Global Constraints (phase-specific reminders)

- All money values are `Decimal` in code, serialized to **strings** at the API/view boundary via `lib/money.ts` (`formatXlm`/`formatPhp`/`displayXlm`/`displayPhp`). Never `number` for money.
- Every mutating handler calls `assertSameOrigin(req)` and `await requireRole("MERCHANT")`; every read/write is scoped by the session user's own `Merchant` row (ownership = `Merchant.userId === session.id`).
- **PII:** `Merchant.accountNumber` is envelope-encrypted at rest; the API and UI only ever expose `accountNumberLast4`. `serializeMerchant` must never include `accountNumber`. Never log it.
- BRAND tokens only — no raw hex/px. Cyan `primary` = trust/confirmed; orange `secondary` = live/pending/processing. Data surfaces use `rounded-lg`; tables use `bg-surface-container-low` headers with `label-md` and `mono-data` amounts (paired XLM bold + PHP beneath). Respect `prefers-reduced-motion`; tap targets ≥ 44×44px; status by text+dot, not color alone.

## Conventions used by every task in this phase

1. **Integration-test seam.** API integration tests run against the real test Postgres (helpers from Phase 2: `tests/helpers/db.ts` exporting `resetDb()` and `prisma`). They control the session by `vi.mock("@/server/auth/sessions", …)` so `requireRole` resolves to a seeded MERCHANT `SessionUser`. Requests are built as `new NextRequest(url, { method, headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body })` and passed to the exported handler with `{ params: Promise.resolve({}) }`. `tests/helpers/merchant.ts` (created in Task 1) centralizes this.
2. **Step-1 placeholder fields.** `Merchant` requires non-null `qrphRaw`, `settlementBankCode`, `settlementBankName`, `accountName`, `accountNumber`, `accountNumberLast4` (SPEC §4). A step-1 `DRAFT` only has `businessName`, so create the row with **empty-string placeholders** for the not-yet-collected required fields; `merchantSetupState` treats empty string as "not set".
3. **RSC reads call service functions directly** (`src/server/merchant/service.ts`), not `fetch`. Only Client Components (wizard, filters, settings forms) call the JSON API over HTTP.

---

### Task 1: Merchant domain module — banks, schemas, serialize, setup-state, service

**Files:**

- Create: `src/server/merchant/banks.ts`
- Create: `src/lib/schemas/merchant.ts`
- Create: `src/server/merchant/service.ts`
- Create: `tests/helpers/merchant.ts`
- Test: `tests/server/merchant/service.test.ts`

**Interfaces:**

- Consumes: `prisma` (`@/server/db`), `Merchant`/`Payment`/`MerchantStatus`/`PaymentStatus`/`Role` (`@/generated/prisma`), `Decimal`/`dec`/`formatXlm`/`formatPhp` (`@/lib/money`), `notFound` (`@/lib/errors`), `decodeQrph` (`@/server/qrph/decode`).
- Produces:

  ```typescript
  // src/server/merchant/banks.ts
  export type SupportedBank = { code: string; name: string };
  export const SUPPORTED_BANKS: readonly SupportedBank[];
  export function getBankName(code: string): string | null; // null if unsupported

  // src/lib/schemas/merchant.ts
  export const createMerchantSchema:    z.ZodObject<{ businessName: z.ZodString }>;
  export const patchMerchantSchema:     z.ZodObject<…>; // { businessName?, logoKey? }
  export const settlementSchema:        z.ZodObject<{ bankCode; accountName; accountNumber }>;
  export const qrphSchema:              z.ZodObject<{ raw: z.ZodString; imageKey: z.ZodOptional<z.ZodString> }>;
  export const txQuerySchema:           z.ZodObject<{ status?; from?; to?; cursor?; limit }>;
  export type CreateMerchantInput = z.infer<typeof createMerchantSchema>;
  export type SettlementInput     = z.infer<typeof settlementSchema>;
  export type QrphInput           = z.infer<typeof qrphSchema>;
  export type TxQuery             = z.infer<typeof txQuerySchema>;

  // src/server/merchant/service.ts
  export type MerchantDto = {
    id: string; businessName: string; logoKey: string | null; status: MerchantStatus;
    qrphRaw: string; qrphMerchantName: string | null; qrphMerchantCity: string | null;
    qrphMerchantId: string | null; qrphImageKey: string | null;
    qrphCountry: string | null; qrphCurrency: string | null;
    settlementBankCode: string; settlementBankName: string; accountName: string;
    accountNumberLast4: string; createdAt: string; updatedAt: string;
  };
  export type SetupState = { hasBusiness: boolean; hasSettlement: boolean; hasQrph: boolean; isComplete: boolean };
  export type MerchantTxItem = { id: string; reference: string; customer: string; amountXlm: string; amountPhp: string; netSettledPhp: string | null; status: PaymentStatus; createdAt: string };
  export type MerchantTxPage = { items: MerchantTxItem[]; nextCursor: string | null };
  export type MerchantEarnings = { totalSettledPhp: string; momChangePct: number | null; pendingXlm: string };

  export const PENDING_STATUSES: PaymentStatus[]; // in-flight (non-terminal) trade/settle states
  export function serializeMerchant(m: Merchant): MerchantDto;       // NEVER includes accountNumber
  export function merchantSetupState(m: Merchant): SetupState;
  export function getMerchantForUserOrNull(userId: string): Promise<Merchant | null>;
  export function getMerchantForUser(userId: string): Promise<Merchant>; // throws notFound()
  export function getMerchantEarnings(merchantId: string): Promise<MerchantEarnings>;
  export function listMerchantTransactions(merchantId: string, q: TxQuery): Promise<MerchantTxPage>;
  export function allMerchantTransactions(merchantId: string, q: Omit<TxQuery,"cursor"|"limit">): Promise<MerchantTxItem[]>; // CSV export, no paging
  ```

- [ ] **Step 1: Write the failing test** — `tests/server/merchant/service.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, prisma } from "../../helpers/db";
import { seedMerchantUser, seedPayment } from "../../helpers/merchant";
import {
  serializeMerchant,
  merchantSetupState,
  getMerchantEarnings,
  listMerchantTransactions,
  PENDING_STATUSES,
} from "@/server/merchant/service";
import { getBankName, SUPPORTED_BANKS } from "@/server/merchant/banks";

beforeEach(async () => {
  await resetDb();
});

describe("banks", () => {
  it("resolves a supported bank code and rejects unknown", () => {
    expect(getBankName(SUPPORTED_BANKS[0].code)).toBe(SUPPORTED_BANKS[0].name);
    expect(getBankName("NOPE")).toBeNull();
  });
});

describe("serializeMerchant", () => {
  it("exposes last4 but never the full account number", async () => {
    const { merchant } = await seedMerchantUser({
      accountNumber: "1234567890",
      accountNumberLast4: "7890",
      settlementBankCode: "BPI",
    });
    const dto = serializeMerchant(merchant) as Record<string, unknown>;
    expect(dto.accountNumberLast4).toBe("7890");
    expect(dto.accountNumber).toBeUndefined();
    expect(JSON.stringify(dto)).not.toContain("1234567890");
  });
});

describe("merchantSetupState", () => {
  it("flags an empty-placeholder DRAFT as incomplete", async () => {
    const { merchant } = await seedMerchantUser({
      qrphRaw: "",
      settlementBankCode: "",
      accountNumberLast4: "",
    });
    expect(merchantSetupState(merchant)).toEqual({
      hasBusiness: true,
      hasSettlement: false,
      hasQrph: false,
      isComplete: false,
    });
  });
  it("flags a fully-populated merchant complete", async () => {
    const { merchant } = await seedMerchantUser({});
    expect(merchantSetupState(merchant).isComplete).toBe(true);
  });
});

describe("getMerchantEarnings", () => {
  it("sums SETTLED netSettledPhp, in-flight XLM, and computes MoM", async () => {
    const { merchant } = await seedMerchantUser({});
    await seedPayment(merchant.id, {
      status: "SETTLED",
      netSettledPhp: "100.00",
      settledAt: new Date(),
    });
    await seedPayment(merchant.id, {
      status: "SETTLED",
      netSettledPhp: "50.00",
      settledAt: new Date(),
    });
    await seedPayment(merchant.id, { status: "PDAX_TRADING", amountXlm: "12.5000000" });
    const e = await getMerchantEarnings(merchant.id);
    expect(e.totalSettledPhp).toBe("150.00");
    expect(e.pendingXlm).toBe("12.5000000");
    expect(PENDING_STATUSES).toContain("PDAX_TRADING");
  });
});

describe("listMerchantTransactions", () => {
  it("filters by status and paginates by cursor", async () => {
    const { merchant } = await seedMerchantUser({});
    for (let i = 0; i < 3; i++)
      await seedPayment(merchant.id, { status: "SETTLED", netSettledPhp: "10.00" });
    await seedPayment(merchant.id, { status: "FAILED" });
    const page1 = await listMerchantTransactions(merchant.id, { status: "SETTLED", limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await listMerchantTransactions(merchant.id, {
      status: "SETTLED",
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });
});
```

- [ ] **Step 2: Write `tests/helpers/merchant.ts`** (shared by every later task)

```typescript
import { prisma } from "./db";
import { vi } from "vitest";
import { encryptSecret } from "@/server/crypto/envelope";
import { newPaymentReference } from "@/server/payments/reference";
import type { SessionUser } from "@/server/auth/sessions";
import type { Merchant, PaymentStatus } from "@/generated/prisma";

let counter = 0;
const VALID_QRPH =
  // a CRC-valid static EMVCo QRPH fixture produced by the Phase 3 parser tests
  "00020101021128660011ph.ppmi.p2m0111PARTNERBANK0208123456780308MERCHID01520400005303608" +
  "5802PH5909HEYPAY CAFE6005DAVAO6304";

export async function seedMerchantUser(overrides: Partial<Merchant> = {}) {
  counter += 1;
  const user = await prisma.user.create({
    data: { username: `merchant${counter}`, passwordHash: "x", role: "MERCHANT" },
  });
  const merchant = await prisma.merchant.create({
    data: {
      userId: user.id,
      businessName: "HeyPay Cafe",
      status: "ACTIVE",
      qrphRaw: VALID_QRPH + "ABCD",
      qrphMerchantName: "HEYPAY CAFE",
      qrphMerchantId: "MERCHID01",
      qrphMerchantCity: "DAVAO",
      settlementBankCode: "BPI",
      settlementBankName: "Bank of the Philippine Islands",
      accountName: "Maria Cruz",
      accountNumber: encryptSecret("1234567890"),
      accountNumberLast4: "7890",
      ...overrides,
    },
  });
  return { user, merchant };
}

export async function seedPayment(
  merchantId: string,
  data: Partial<{
    status: PaymentStatus;
    netSettledPhp: string;
    amountXlm: string;
    settledAt: Date;
  }>,
) {
  const payer = await prisma.user.create({
    data: { username: `payer${++counter}`, passwordHash: "x", role: "PAYER" },
  });
  return prisma.payment.create({
    data: {
      reference: newPaymentReference(),
      payerId: payer.id,
      merchantId,
      amountPhp: "100.00",
      quotedRate: "8.00000000",
      amountXlm: data.amountXlm ?? "12.5000000",
      netSettledPhp: data.netSettledPhp ?? null,
      status: data.status ?? "CREATED",
      settledAt: data.settledAt ?? null,
    },
  });
}

/** Mocks the sessions module so requireRole/requireUser resolve to `user`. Call at top of an integration test file. */
export function mockSession(user: SessionUser) {
  vi.mock("@/server/auth/sessions", async (orig) => {
    const actual = await orig<typeof import("@/server/auth/sessions")>();
    return {
      ...actual,
      getSessionUser: vi.fn(async () => user),
      requireUser: vi.fn(async () => user),
      requireRole: vi.fn(async () => user),
    };
  });
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run tests/server/merchant/service.test.ts`
Expected: FAIL — `Cannot find module '@/server/merchant/banks'`.

- [ ] **Step 4: Implement `src/server/merchant/banks.ts`**

```typescript
export type SupportedBank = { code: string; name: string };

export const SUPPORTED_BANKS: readonly SupportedBank[] = [
  { code: "BPI", name: "Bank of the Philippine Islands" },
  { code: "BDO", name: "BDO Unibank" },
  { code: "UBP", name: "UnionBank of the Philippines" },
  { code: "METROBANK", name: "Metrobank" },
  { code: "LANDBANK", name: "Land Bank of the Philippines" },
  { code: "PNB", name: "Philippine National Bank" },
  { code: "SECURITYBANK", name: "Security Bank" },
  { code: "RCBC", name: "Rizal Commercial Banking Corp." },
  { code: "GCASH", name: "GCash" },
  { code: "MAYA", name: "Maya" },
] as const;

const BY_CODE = new Map(SUPPORTED_BANKS.map((b) => [b.code, b.name]));

export function getBankName(code: string): string | null {
  return BY_CODE.get(code) ?? null;
}
```

- [ ] **Step 5: Implement `src/lib/schemas/merchant.ts`**

```typescript
import { z } from "zod";
import { SUPPORTED_BANKS } from "@/server/merchant/banks";

const BANK_CODES = SUPPORTED_BANKS.map((b) => b.code) as [string, ...string[]];
const STATUSES = [
  "CREATED",
  "QUOTED",
  "AUTHORIZED",
  "STELLAR_SUBMITTED",
  "STELLAR_CONFIRMED",
  "PDAX_TRADING",
  "PDAX_TRADED",
  "PAYOUT_SUBMITTED",
  "SETTLED",
  "FAILED",
  "REFUND_PENDING",
  "REFUNDED",
] as const;

export const createMerchantSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
});

export const patchMerchantSchema = z
  .object({
    businessName: z.string().trim().min(2).max(120).optional(),
    logoKey: z.string().trim().min(1).max(256).optional(),
  })
  .refine((v) => v.businessName !== undefined || v.logoKey !== undefined, {
    message: "No fields to update",
  });

export const settlementSchema = z.object({
  bankCode: z.enum(BANK_CODES),
  accountName: z.string().trim().min(2).max(120),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{6,20}$/, "6–20 digits"),
});

export const qrphSchema = z.object({
  raw: z.string().trim().min(20).max(1024),
  imageKey: z.string().trim().min(1).max(256).optional(),
});

export const txQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateMerchantInput = z.infer<typeof createMerchantSchema>;
export type PatchMerchantInput = z.infer<typeof patchMerchantSchema>;
export type SettlementInput = z.infer<typeof settlementSchema>;
export type QrphInput = z.infer<typeof qrphSchema>;
export type TxQuery = z.infer<typeof txQuerySchema>;
```

- [ ] **Step 6: Implement `src/server/merchant/service.ts`**

```typescript
import "server-only";
import { prisma } from "@/server/db";
import { notFound } from "@/lib/errors";
import { dec, formatXlm, formatPhp } from "@/lib/money";
import type { Merchant, Payment, PaymentStatus } from "@/generated/prisma";
import { MerchantStatus } from "@/generated/prisma";
import type { TxQuery } from "@/lib/schemas/merchant";

export type MerchantDto = {
  id: string;
  businessName: string;
  logoKey: string | null;
  status: MerchantStatus;
  qrphRaw: string;
  qrphMerchantName: string | null;
  qrphMerchantCity: string | null;
  qrphMerchantId: string | null;
  qrphImageKey: string | null;
  qrphCountry: string | null;
  qrphCurrency: string | null;
  settlementBankCode: string;
  settlementBankName: string;
  accountName: string;
  accountNumberLast4: string;
  createdAt: string;
  updatedAt: string;
};
export type SetupState = {
  hasBusiness: boolean;
  hasSettlement: boolean;
  hasQrph: boolean;
  isComplete: boolean;
};
export type MerchantTxItem = {
  id: string;
  reference: string;
  customer: string;
  amountXlm: string;
  amountPhp: string;
  netSettledPhp: string | null;
  status: PaymentStatus;
  createdAt: string;
};
export type MerchantTxPage = { items: MerchantTxItem[]; nextCursor: string | null };
export type MerchantEarnings = {
  totalSettledPhp: string;
  momChangePct: number | null;
  pendingXlm: string;
};

/** Non-terminal in-flight states whose XLM is "pending" (post-authorization, pre-settlement). */
export const PENDING_STATUSES: PaymentStatus[] = [
  "AUTHORIZED",
  "STELLAR_SUBMITTED",
  "STELLAR_CONFIRMED",
  "PDAX_TRADING",
  "PDAX_TRADED",
  "PAYOUT_SUBMITTED",
];

export function serializeMerchant(m: Merchant): MerchantDto {
  return {
    id: m.id,
    businessName: m.businessName,
    logoKey: m.logoKey,
    status: m.status,
    qrphRaw: m.qrphRaw,
    qrphMerchantName: m.qrphMerchantName,
    qrphMerchantCity: m.qrphMerchantCity,
    qrphMerchantId: m.qrphMerchantId,
    qrphImageKey: m.qrphImageKey,
    qrphCountry: m.qrphCountry,
    qrphCurrency: m.qrphCurrency,
    settlementBankCode: m.settlementBankCode,
    settlementBankName: m.settlementBankName,
    accountName: m.accountName,
    accountNumberLast4: m.accountNumberLast4,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export function merchantSetupState(m: Merchant): SetupState {
  const hasBusiness = m.businessName.trim().length > 0;
  const hasSettlement = m.settlementBankCode.length > 0 && m.accountNumberLast4.length > 0;
  const hasQrph = m.qrphRaw.length > 0;
  return {
    hasBusiness,
    hasSettlement,
    hasQrph,
    isComplete: hasBusiness && hasSettlement && hasQrph,
  };
}

export function getMerchantForUserOrNull(userId: string): Promise<Merchant | null> {
  return prisma.merchant.findUnique({ where: { userId } });
}

export async function getMerchantForUser(userId: string): Promise<Merchant> {
  const m = await getMerchantForUserOrNull(userId);
  if (!m) throw notFound("Merchant profile not found");
  return m;
}

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function getMerchantEarnings(merchantId: string): Promise<MerchantEarnings> {
  const settled = await prisma.payment.findMany({
    where: { merchantId, status: "SETTLED" },
    select: { netSettledPhp: true, settledAt: true },
  });
  const pending = await prisma.payment.findMany({
    where: { merchantId, status: { in: PENDING_STATUSES } },
    select: { amountXlm: true },
  });

  let total = dec(0),
    thisMonth = dec(0),
    lastMonth = dec(0);
  const now = new Date();
  const curStart = monthStart(now);
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  for (const p of settled) {
    const v = dec(p.netSettledPhp?.toString() ?? "0");
    total = total.plus(v);
    const at = p.settledAt ?? undefined;
    if (at && at >= curStart) thisMonth = thisMonth.plus(v);
    else if (at && at >= prevStart && at < curStart) lastMonth = lastMonth.plus(v);
  }
  let pendingXlm = dec(0);
  for (const p of pending) pendingXlm = pendingXlm.plus(dec(p.amountXlm.toString()));

  const momChangePct = lastMonth.isZero()
    ? null
    : Number(
        thisMonth.minus(lastMonth).dividedBy(lastMonth).times(100).toDecimalPlaces(1).toString(),
      );

  return {
    totalSettledPhp: formatPhp(total),
    momChangePct,
    pendingXlm: formatXlm(pendingXlm),
  };
}

function mapTx(p: Payment & { payer: { username: string } }): MerchantTxItem {
  return {
    id: p.id,
    reference: p.reference,
    customer: p.payer.username,
    amountXlm: formatXlm(dec(p.amountXlm.toString())),
    amountPhp: formatPhp(dec(p.amountPhp.toString())),
    netSettledPhp: p.netSettledPhp ? formatPhp(dec(p.netSettledPhp.toString())) : null,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  };
}

function txWhere(merchantId: string, q: Pick<TxQuery, "status" | "from" | "to">) {
  return {
    merchantId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.from || q.to
      ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
      : {}),
  };
}

export async function listMerchantTransactions(
  merchantId: string,
  q: TxQuery,
): Promise<MerchantTxPage> {
  const take = q.limit + 1;
  const rows = await prisma.payment.findMany({
    where: txWhere(merchantId, q),
    include: { payer: { select: { username: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    take,
  });
  const hasMore = rows.length === take;
  const items = (hasMore ? rows.slice(0, q.limit) : rows).map(mapTx);
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export async function allMerchantTransactions(
  merchantId: string,
  q: Pick<TxQuery, "status" | "from" | "to">,
): Promise<MerchantTxItem[]> {
  const rows = await prisma.payment.findMany({
    where: txWhere(merchantId, q),
    include: { payer: { select: { username: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(mapTx);
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm vitest run tests/server/merchant/service.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 8: Commit**

```bash
git add src/server/merchant src/lib/schemas/merchant.ts tests/helpers/merchant.ts tests/server/merchant/service.test.ts
git commit -m "feat(merchant): domain module — banks, schemas, serialize, setup-state, earnings/tx service"
```

---

### Task 2: `POST /api/merchant` (step 1) + `GET`/`PATCH /api/merchant/me`

**Files:**

- Create: `src/app/api/merchant/route.ts`
- Create: `src/app/api/merchant/me/route.ts`
- Test: `tests/api/merchant/profile.test.ts`

**Interfaces:**

- Consumes: `route`/`json`/`parseBody` (`@/lib/http`), `assertSameOrigin` (`@/server/auth/csrf`), `requireRole` (`@/server/auth/sessions`), `audit` (`@/server/auth/audit`), `conflict`/`notFound` (`@/lib/errors`), `prisma` (`@/server/db`), `createMerchantSchema`/`patchMerchantSchema` (`@/lib/schemas/merchant`), `serializeMerchant`/`merchantSetupState`/`getMerchantForUser`/`getMerchantForUserOrNull` (`@/server/merchant/service`).
- Produces: `POST /api/merchant` → `{ merchant: MerchantDto }` (201, creates `DRAFT`); `GET /api/merchant/me` → `{ merchant: MerchantDto; setup: SetupState }`; `PATCH /api/merchant/me` → `{ merchant: MerchantDto; setup: SetupState }`.

- [ ] **Step 1: Write the failing test** — `tests/api/merchant/profile.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, prisma } from "../../helpers/db";
import { mockSession } from "../../helpers/merchant";

const USER = { id: "", username: "biz", role: "MERCHANT" as const, isActive: true };
mockSession(USER);

const req = (method: string, body?: unknown) =>
  new NextRequest("http://localhost:3000/api/merchant", {
    method,
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
const ctx = { params: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
  const u = await prisma.user.create({
    data: { username: "biz", passwordHash: "x", role: "MERCHANT" },
  });
  USER.id = u.id;
});

it("POST /api/merchant creates a DRAFT with empty placeholders", async () => {
  const { POST } = await import("@/app/api/merchant/route");
  const res = await POST(req("POST", { businessName: "Coffee Co" }), ctx);
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.merchant.status).toBe("DRAFT");
  expect(body.merchant.businessName).toBe("Coffee Co");
  expect(body.merchant.accountNumberLast4).toBe("");
  expect(body.merchant).not.toHaveProperty("accountNumber");
});

it("POST /api/merchant is conflict when one already exists", async () => {
  const { POST } = await import("@/app/api/merchant/route");
  await POST(req("POST", { businessName: "First" }), ctx);
  const res = await POST(req("POST", { businessName: "Second" }), ctx);
  expect(res.status).toBe(409);
});

it("GET /api/merchant/me returns merchant + setup; PATCH updates name", async () => {
  const { POST } = await import("@/app/api/merchant/route");
  await POST(req("POST", { businessName: "Coffee Co" }), ctx);
  const me = await import("@/app/api/merchant/me/route");
  const got = await me.GET(req("GET"), ctx);
  const gotBody = await got.json();
  expect(gotBody.setup.isComplete).toBe(false);
  const patched = await me.PATCH(req("PATCH", { businessName: "Bean Co" }), ctx);
  expect((await patched.json()).merchant.businessName).toBe("Bean Co");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/api/merchant/profile.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/merchant/route'`.

- [ ] **Step 3: Implement `src/app/api/merchant/route.ts`**

```typescript
import { route, json, parseBody } from "@/lib/http";
import { assertSameOrigin } from "@/server/auth/csrf";
import { requireRole } from "@/server/auth/sessions";
import { audit } from "@/server/auth/audit";
import { conflict } from "@/lib/errors";
import { prisma } from "@/server/db";
import { createMerchantSchema } from "@/lib/schemas/merchant";
import { serializeMerchant, getMerchantForUserOrNull } from "@/server/merchant/service";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireRole("MERCHANT");
  const { businessName } = await parseBody(req, createMerchantSchema);

  if (await getMerchantForUserOrNull(user.id)) {
    throw conflict("Merchant profile already exists");
  }

  const merchant = await prisma.merchant.create({
    data: {
      userId: user.id,
      businessName,
      status: "DRAFT",
      qrphRaw: "",
      settlementBankCode: "",
      settlementBankName: "",
      accountName: "",
      accountNumber: "",
      accountNumberLast4: "",
    },
  });
  await audit({ actorId: user.id, action: "merchant.create", target: merchant.id });
  return json({ merchant: serializeMerchant(merchant) }, 201);
});
```

- [ ] **Step 4: Implement `src/app/api/merchant/me/route.ts`**

```typescript
import { route, json, parseBody } from "@/lib/http";
import { assertSameOrigin } from "@/server/auth/csrf";
import { requireRole } from "@/server/auth/sessions";
import { audit } from "@/server/auth/audit";
import { prisma } from "@/server/db";
import { patchMerchantSchema } from "@/lib/schemas/merchant";
import {
  serializeMerchant,
  merchantSetupState,
  getMerchantForUser,
} from "@/server/merchant/service";

export const GET = route(async () => {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUser(user.id);
  return json({ merchant: serializeMerchant(merchant), setup: merchantSetupState(merchant) });
});

export const PATCH = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireRole("MERCHANT");
  const existing = await getMerchantForUser(user.id);
  const patch = await parseBody(req, patchMerchantSchema);

  const merchant = await prisma.merchant.update({
    where: { id: existing.id },
    data: {
      ...(patch.businessName !== undefined ? { businessName: patch.businessName } : {}),
      ...(patch.logoKey !== undefined ? { logoKey: patch.logoKey } : {}),
    },
  });
  await audit({ actorId: user.id, action: "merchant.update", target: merchant.id });
  return json({ merchant: serializeMerchant(merchant), setup: merchantSetupState(merchant) });
});
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/api/merchant/profile.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/merchant/route.ts src/app/api/merchant/me/route.ts tests/api/merchant/profile.test.ts
git commit -m "feat(merchant): POST /api/merchant + GET/PATCH /api/merchant/me"
```

---

### Task 3: `POST /api/merchant/settlement` (validate bank, encrypt account, store last4)

**Files:**

- Create: `src/app/api/merchant/settlement/route.ts`
- Test: `tests/api/merchant/settlement.test.ts`

**Interfaces:**

- Consumes: `route`/`json`/`parseBody`, `assertSameOrigin`, `requireRole`, `audit`, `badRequest` (`@/lib/errors`), `prisma`, `encryptSecret` (`@/server/crypto/envelope`), `settlementSchema`, `getBankName` (`@/server/merchant/banks`), `serializeMerchant`/`getMerchantForUser`.
- Produces: `POST /api/merchant/settlement` → `{ merchant: MerchantDto }`. Encrypts `accountNumber`, stores `accountNumberLast4 = accountNumber.slice(-4)`, resolves and stores `settlementBankName`.

- [ ] **Step 1: Write the failing test** — `tests/api/merchant/settlement.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, prisma } from "../../helpers/db";
import { mockSession, seedMerchantUser } from "../../helpers/merchant";
import { decryptSecret } from "@/server/crypto/envelope";

const USER = { id: "", username: "biz", role: "MERCHANT" as const, isActive: true };
mockSession(USER);
const req = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/merchant/settlement", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
});

it("stores encrypted account + last4 + resolved bank name", async () => {
  const { merchant, user } = await seedMerchantUser({
    settlementBankCode: "",
    accountNumberLast4: "",
    accountNumber: "",
    accountName: "",
  });
  USER.id = user.id;
  const { POST } = await import("@/app/api/merchant/settlement/route");
  const res = await POST(
    req({ bankCode: "BPI", accountName: "Maria Cruz", accountNumber: "1234567890" }),
    ctx,
  );
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.merchant.settlementBankName).toBe("Bank of the Philippine Islands");
  expect(body.merchant.accountNumberLast4).toBe("7890");
  expect(body.merchant).not.toHaveProperty("accountNumber");

  const row = await prisma.merchant.findUnique({ where: { id: merchant.id } });
  expect(row!.accountNumber).not.toContain("1234567890"); // encrypted at rest
  expect(decryptSecret(row!.accountNumber)).toBe("1234567890"); // round-trips
});

it("rejects an unsupported bank code with 400", async () => {
  const { user } = await seedMerchantUser({});
  USER.id = user.id;
  const { POST } = await import("@/app/api/merchant/settlement/route");
  const res = await POST(
    req({ bankCode: "FAKEBANK", accountName: "X Y", accountNumber: "12345678" }),
    ctx,
  );
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/api/merchant/settlement.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/app/api/merchant/settlement/route.ts`**

```typescript
import { route, json, parseBody } from "@/lib/http";
import { assertSameOrigin } from "@/server/auth/csrf";
import { requireRole } from "@/server/auth/sessions";
import { audit } from "@/server/auth/audit";
import { badRequest } from "@/lib/errors";
import { prisma } from "@/server/db";
import { encryptSecret } from "@/server/crypto/envelope";
import { settlementSchema } from "@/lib/schemas/merchant";
import { getBankName } from "@/server/merchant/banks";
import { serializeMerchant, getMerchantForUser } from "@/server/merchant/service";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireRole("MERCHANT");
  const existing = await getMerchantForUser(user.id);
  const { bankCode, accountName, accountNumber } = await parseBody(req, settlementSchema);

  const bankName = getBankName(bankCode);
  if (!bankName) throw badRequest("Unsupported bank code");

  const merchant = await prisma.merchant.update({
    where: { id: existing.id },
    data: {
      settlementBankCode: bankCode,
      settlementBankName: bankName,
      accountName,
      accountNumber: encryptSecret(accountNumber),
      accountNumberLast4: accountNumber.slice(-4),
    },
  });
  await audit({ actorId: user.id, action: "merchant.settlement.set", target: merchant.id });
  return json({ merchant: serializeMerchant(merchant) });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/api/merchant/settlement.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/merchant/settlement/route.ts tests/api/merchant/settlement.test.ts
git commit -m "feat(merchant): POST /api/merchant/settlement with bank validation + envelope-encrypted account"
```

---

### Task 4: `POST /api/merchant/qrph` (decode + CRC + uniqueness + persist + verify image)

**Files:**

- Create: `src/app/api/merchant/qrph/route.ts`
- Test: `tests/api/merchant/qrph.test.ts`

**Interfaces:**

- Consumes: `route`/`json`/`parseBody`, `assertSameOrigin`, `requireRole`, `audit`, `badRequest`/`conflict`, `prisma`, `decodeQrph` (`@/server/qrph/decode`), `verifyUploadedObject` (`@/server/storage/s3`), `qrphSchema`, `serializeMerchant`/`getMerchantForUser`.
- Produces: `POST /api/merchant/qrph` → `{ merchant: MerchantDto; decoded: QrphDecoded }`. Validates CRC, rejects duplicate `qrphRaw` already owned by another merchant, verifies uploaded image bytes when `imageKey` is supplied, persists all `qrph*` fields.

- [ ] **Step 1: Write the failing test** — `tests/api/merchant/qrph.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, prisma } from "../../helpers/db";
import { mockSession, seedMerchantUser } from "../../helpers/merchant";

// CRC-valid fixture string (matches Phase 3 parser fixtures)
const RAW =
  "00020101021128660011ph.ppmi.p2m0111PARTNERBANK0208123456780308MERCHID01520400005303608" +
  "5802PH5909HEYPAY CAFE6005DAVAO63041A2B";

vi.mock("@/server/qrph/decode", () => ({
  decodeQrph: (raw: string) => ({
    raw,
    payloadFormat: "01",
    pointOfInit: "static",
    merchantName: "HEYPAY CAFE",
    merchantCity: "DAVAO",
    merchantId: "MERCHID01",
    acquirerId: "PARTNERBANK",
    country: "PH",
    currency: "608",
    crcValid: raw === RAW,
    amountPhp: undefined,
  }),
}));
vi.mock("@/server/storage/s3", () => ({ verifyUploadedObject: vi.fn(async () => {}) }));

const USER = { id: "", username: "biz", role: "MERCHANT" as const, isActive: true };
mockSession(USER);
const req = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/merchant/qrph", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
});

it("persists decoded QRPH fields and verifies the uploaded image", async () => {
  const { verifyUploadedObject } = await import("@/server/storage/s3");
  const { merchant, user } = await seedMerchantUser({ qrphRaw: "" });
  USER.id = user.id;
  const { POST } = await import("@/app/api/merchant/qrph/route");
  const res = await POST(req({ raw: RAW, imageKey: "qrph/abc.png" }), ctx);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.merchant.qrphMerchantName).toBe("HEYPAY CAFE");
  expect(body.merchant.qrphImageKey).toBe("qrph/abc.png");
  expect(verifyUploadedObject).toHaveBeenCalledWith("qrph/abc.png");
  const row = await prisma.merchant.findUnique({ where: { id: merchant.id } });
  expect(row!.qrphMerchantId).toBe("MERCHID01");
});

it("rejects a QRPH already owned by another merchant (409)", async () => {
  await seedMerchantUser({ qrphRaw: RAW, qrphMerchantId: "MERCHID01" }); // someone else owns it
  const { user } = await seedMerchantUser({ qrphRaw: "" });
  USER.id = user.id;
  const { POST } = await import("@/app/api/merchant/qrph/route");
  const res = await POST(req({ raw: RAW }), ctx);
  expect(res.status).toBe(409);
});

it("rejects a CRC-invalid string (400)", async () => {
  const { user } = await seedMerchantUser({ qrphRaw: "" });
  USER.id = user.id;
  const { POST } = await import("@/app/api/merchant/qrph/route");
  const res = await POST(req({ raw: RAW.slice(0, -4) + "0000" }), ctx);
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/api/merchant/qrph.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/app/api/merchant/qrph/route.ts`**

```typescript
import { route, json, parseBody } from "@/lib/http";
import { assertSameOrigin } from "@/server/auth/csrf";
import { requireRole } from "@/server/auth/sessions";
import { audit } from "@/server/auth/audit";
import { badRequest, conflict } from "@/lib/errors";
import { prisma } from "@/server/db";
import { decodeQrph } from "@/server/qrph/decode";
import { verifyUploadedObject } from "@/server/storage/s3";
import { qrphSchema } from "@/lib/schemas/merchant";
import { serializeMerchant, getMerchantForUser } from "@/server/merchant/service";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireRole("MERCHANT");
  const existing = await getMerchantForUser(user.id);
  const { raw, imageKey } = await parseBody(req, qrphSchema);

  const decoded = decodeQrph(raw); // throws badRequest on malformed TLV
  if (!decoded.crcValid) throw badRequest("QRPH CRC validation failed");
  if (decoded.currency && decoded.currency !== "608")
    throw badRequest("Only PHP (608) QRPH is supported");

  // Uniqueness: no other merchant may already own this code.
  const dupe = await prisma.merchant.findFirst({
    where: { qrphRaw: raw, NOT: { id: existing.id } },
    select: { id: true },
  });
  if (dupe) throw conflict("This QRPH is already registered to another HeyPay merchant");

  if (imageKey) await verifyUploadedObject(imageKey); // magic-byte + size check

  const merchant = await prisma.merchant.update({
    where: { id: existing.id },
    data: {
      qrphRaw: raw,
      qrphMerchantName: decoded.merchantName ?? null,
      qrphMerchantCity: decoded.merchantCity ?? null,
      qrphMerchantId: decoded.merchantId ?? null,
      qrphAcquirerId: decoded.acquirerId ?? null,
      qrphCountry: decoded.country ?? "PH",
      qrphCurrency: decoded.currency ?? "608",
      ...(imageKey ? { qrphImageKey: imageKey } : {}),
    },
  });
  await audit({ actorId: user.id, action: "merchant.qrph.set", target: merchant.id });
  return json({ merchant: serializeMerchant(merchant), decoded });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/api/merchant/qrph.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/merchant/qrph/route.ts tests/api/merchant/qrph.test.ts
git commit -m "feat(merchant): POST /api/merchant/qrph — decode, CRC, uniqueness, image verify, persist"
```

---

### Task 5: `POST /api/merchant/go-live` (completeness gate → ACTIVE / PENDING_REVIEW)

**Files:**

- Create: `src/app/api/merchant/go-live/route.ts`
- Test: `tests/api/merchant/go-live.test.ts`

**Interfaces:**

- Consumes: `route`/`json`, `assertSameOrigin`, `requireRole`, `audit`, `badRequest`, `prisma`, `decodeQrph`, `merchantSetupState`/`serializeMerchant`/`getMerchantForUser`.
- Produces: `POST /api/merchant/go-live` → `{ merchant: MerchantDto }`. Requires `businessName` + CRC-valid QRPH + settlement account; sets `ACTIVE`, or `PENDING_REVIEW` when env `MERCHANT_REVIEW_GATE` is truthy.

- [ ] **Step 1: Write the failing test** — `tests/api/merchant/go-live.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../../helpers/db";
import { mockSession, seedMerchantUser } from "../../helpers/merchant";

vi.mock("@/server/qrph/decode", () => ({
  decodeQrph: (raw: string) => ({
    raw,
    crcValid: raw.length > 10,
    country: "PH",
    currency: "608",
    pointOfInit: "static",
    payloadFormat: "01",
  }),
}));

const USER = { id: "", username: "biz", role: "MERCHANT" as const, isActive: true };
mockSession(USER);
const req = () =>
  new NextRequest("http://localhost:3000/api/merchant/go-live", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
  });
const ctx = { params: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
  delete process.env.MERCHANT_REVIEW_GATE;
});

it("activates a fully-configured merchant", async () => {
  const { user } = await seedMerchantUser({ status: "DRAFT" });
  USER.id = user.id;
  const { POST } = await import("@/app/api/merchant/go-live/route");
  const res = await POST(req(), ctx);
  expect(res.status).toBe(200);
  expect((await res.json()).merchant.status).toBe("ACTIVE");
});

it("blocks go-live with 400 when settlement is missing", async () => {
  const { user } = await seedMerchantUser({
    status: "DRAFT",
    settlementBankCode: "",
    accountNumberLast4: "",
  });
  USER.id = user.id;
  const { POST } = await import("@/app/api/merchant/go-live/route");
  const res = await POST(req(), ctx);
  expect(res.status).toBe(400);
});

it("routes to PENDING_REVIEW behind the feature flag", async () => {
  process.env.MERCHANT_REVIEW_GATE = "1";
  const { user } = await seedMerchantUser({ status: "DRAFT" });
  USER.id = user.id;
  const { POST } = await import("@/app/api/merchant/go-live/route");
  const res = await POST(req(), ctx);
  expect((await res.json()).merchant.status).toBe("PENDING_REVIEW");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/api/merchant/go-live.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/app/api/merchant/go-live/route.ts`**

```typescript
import { route, json } from "@/lib/http";
import { assertSameOrigin } from "@/server/auth/csrf";
import { requireRole } from "@/server/auth/sessions";
import { audit } from "@/server/auth/audit";
import { badRequest } from "@/lib/errors";
import { prisma } from "@/server/db";
import { decodeQrph } from "@/server/qrph/decode";
import {
  serializeMerchant,
  merchantSetupState,
  getMerchantForUser,
} from "@/server/merchant/service";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireRole("MERCHANT");
  const existing = await getMerchantForUser(user.id);

  const setup = merchantSetupState(existing);
  if (!setup.hasBusiness) throw badRequest("Business name is required");
  if (!setup.hasSettlement) throw badRequest("A settlement bank account is required");
  if (!setup.hasQrph) throw badRequest("A linked QRPH is required");

  // Re-validate the stored QRPH CRC at go-live (defense in depth).
  let crcValid = false;
  try {
    crcValid = decodeQrph(existing.qrphRaw).crcValid;
  } catch {
    crcValid = false;
  }
  if (!crcValid) throw badRequest("Stored QRPH failed CRC validation — please re-link it");

  const reviewGate = Boolean(process.env.MERCHANT_REVIEW_GATE);
  const merchant = await prisma.merchant.update({
    where: { id: existing.id },
    data: { status: reviewGate ? "PENDING_REVIEW" : "ACTIVE" },
  });
  await audit({
    actorId: user.id,
    action: "merchant.go-live",
    target: merchant.id,
    metadata: { status: merchant.status },
  });
  return json({ merchant: serializeMerchant(merchant) });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run tests/api/merchant/go-live.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/merchant/go-live/route.ts tests/api/merchant/go-live.test.ts
git commit -m "feat(merchant): POST /api/merchant/go-live completeness gate (ACTIVE / PENDING_REVIEW flag)"
```

---

### Task 6: `GET /api/merchant/transactions` + `GET /api/merchant/earnings` + `GET /api/merchant/qr`

**Files:**

- Create: `src/app/api/merchant/transactions/route.ts`
- Create: `src/app/api/merchant/earnings/route.ts`
- Create: `src/app/api/merchant/qr/route.ts`
- Test: `tests/api/merchant/reads.test.ts`

**Interfaces:**

- Consumes: `route`/`json`/`parseQuery`, `requireRole`, `prisma`, `txQuerySchema`, `listMerchantTransactions`/`getMerchantEarnings`/`getMerchantForUser`, `QRCode` (`qrcode`).
- Produces: `GET /api/merchant/transactions?status&from&to&cursor&limit` → `MerchantTxPage`; `GET /api/merchant/earnings` → `MerchantEarnings`; `GET /api/merchant/qr` → `{ qrphRaw: string; qrSvg: string; paymentLink: string }`.

- [ ] **Step 1: Write the failing test** — `tests/api/merchant/reads.test.ts`

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../../helpers/db";
import { mockSession, seedMerchantUser, seedPayment } from "../../helpers/merchant";

const USER = { id: "", username: "biz", role: "MERCHANT" as const, isActive: true };
mockSession(USER);
const get = (url: string) =>
  new NextRequest(url, { method: "GET", headers: { origin: "http://localhost:3000" } });
const ctx = { params: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
  process.env.APP_URL = "http://localhost:3000";
});

it("earnings sums settled + pending", async () => {
  const { merchant, user } = await seedMerchantUser({});
  USER.id = user.id;
  await seedPayment(merchant.id, {
    status: "SETTLED",
    netSettledPhp: "75.00",
    settledAt: new Date(),
  });
  const { GET } = await import("@/app/api/merchant/earnings/route");
  const body = await (await GET(get("http://localhost:3000/api/merchant/earnings"), ctx)).json();
  expect(body.totalSettledPhp).toBe("75.00");
});

it("transactions returns filtered settlement rows", async () => {
  const { merchant, user } = await seedMerchantUser({});
  USER.id = user.id;
  await seedPayment(merchant.id, { status: "SETTLED", netSettledPhp: "10.00" });
  await seedPayment(merchant.id, { status: "FAILED" });
  const { GET } = await import("@/app/api/merchant/transactions/route");
  const body = await (
    await GET(get("http://localhost:3000/api/merchant/transactions?status=SETTLED"), ctx)
  ).json();
  expect(body.items).toHaveLength(1);
  expect(body.items[0].status).toBe("SETTLED");
});

it("qr returns svg + payment link", async () => {
  const { user } = await seedMerchantUser({});
  USER.id = user.id;
  const { GET } = await import("@/app/api/merchant/qr/route");
  const body = await (await GET(get("http://localhost:3000/api/merchant/qr"), ctx)).json();
  expect(body.qrSvg).toContain("<svg");
  expect(body.paymentLink).toContain("http://localhost:3000");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/api/merchant/reads.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/app/api/merchant/transactions/route.ts`**

```typescript
import { route, json, parseQuery } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { txQuerySchema } from "@/lib/schemas/merchant";
import { listMerchantTransactions, getMerchantForUser } from "@/server/merchant/service";

export const GET = route(async (req) => {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUser(user.id);
  const q = parseQuery(req, txQuerySchema);
  return json(await listMerchantTransactions(merchant.id, q));
});
```

- [ ] **Step 4: Implement `src/app/api/merchant/earnings/route.ts`**

```typescript
import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { getMerchantEarnings, getMerchantForUser } from "@/server/merchant/service";

export const GET = route(async () => {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUser(user.id);
  return json(await getMerchantEarnings(merchant.id));
});
```

- [ ] **Step 5: Implement `src/app/api/merchant/qr/route.ts`**

```typescript
import QRCode from "qrcode";
import { route, json } from "@/lib/http";
import { badRequest } from "@/lib/errors";
import { requireRole } from "@/server/auth/sessions";
import { getMerchantForUser } from "@/server/merchant/service";

export const GET = route(async () => {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUser(user.id);
  if (!merchant.qrphRaw) throw badRequest("No QRPH linked yet");

  const qrSvg = await QRCode.toString(merchant.qrphRaw, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
  });
  const base = process.env.APP_URL ?? "";
  const paymentLink = `${base}/pay?m=${merchant.id}`;
  return json({ qrphRaw: merchant.qrphRaw, qrSvg, paymentLink });
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run tests/api/merchant/reads.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/merchant/transactions/route.ts src/app/api/merchant/earnings/route.ts src/app/api/merchant/qr/route.ts tests/api/merchant/reads.test.ts
git commit -m "feat(merchant): GET transactions (filters+cursor), earnings, business qr"
```

---

### Task 7: End-to-end onboarding integration test (create → settlement → qrph → go-live)

**Files:**

- Test: `tests/api/merchant/onboarding-flow.test.ts`

**Interfaces:**

- Consumes: all handlers from Tasks 2–5 + `getMerchantEarnings` (Task 6). No new production code — this task proves the API surface composes (TDD safety net before UI builds on it).

- [ ] **Step 1: Write the integration test** — `tests/api/merchant/onboarding-flow.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, prisma } from "../../helpers/db";
import { mockSession } from "../../helpers/merchant";

const RAW =
  "00020101021128660011ph.ppmi.p2m0111PARTNERBANK0208123456780308MERCHID01520400005303608" +
  "5802PH5909HEYPAY CAFE6005DAVAO63041A2B";
vi.mock("@/server/qrph/decode", () => ({
  decodeQrph: (raw: string) => ({
    raw,
    payloadFormat: "01",
    pointOfInit: "static",
    merchantName: "HEYPAY CAFE",
    merchantCity: "DAVAO",
    merchantId: "MERCHID01",
    acquirerId: "PARTNERBANK",
    country: "PH",
    currency: "608",
    crcValid: true,
  }),
}));
vi.mock("@/server/storage/s3", () => ({ verifyUploadedObject: vi.fn(async () => {}) }));

const USER = { id: "", username: "owner", role: "MERCHANT" as const, isActive: true };
mockSession(USER);
const ctx = { params: Promise.resolve({}) };
const post = (path: string, body?: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

beforeEach(async () => {
  await resetDb();
  const u = await prisma.user.create({
    data: { username: "owner", passwordHash: "x", role: "MERCHANT" },
  });
  USER.id = u.id;
});

it("walks create → settlement → qrph → go-live to ACTIVE", async () => {
  const create = await import("@/app/api/merchant/route");
  const settle = await import("@/app/api/merchant/settlement/route");
  const qrph = await import("@/app/api/merchant/qrph/route");
  const live = await import("@/app/api/merchant/go-live/route");

  expect(
    (await create.POST(post("/api/merchant", { businessName: "HeyPay Cafe" }), ctx)).status,
  ).toBe(201);
  expect(
    (
      await settle.POST(
        post("/api/merchant/settlement", {
          bankCode: "BPI",
          accountName: "Maria Cruz",
          accountNumber: "1234567890",
        }),
        ctx,
      )
    ).status,
  ).toBe(200);
  expect((await qrph.POST(post("/api/merchant/qrph", { raw: RAW }), ctx)).status).toBe(200);

  const res = await live.POST(post("/api/merchant/go-live"), ctx);
  expect((await res.json()).merchant.status).toBe("ACTIVE");
});
```

- [ ] **Step 2: Run it (should pass against Tasks 2–6)**

Run: `pnpm vitest run tests/api/merchant/onboarding-flow.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/api/merchant/onboarding-flow.test.ts
git commit -m "test(merchant): end-to-end onboarding flow integration"
```

---

### Task 8: Shared UI primitives — FloatingInput, StatusBadge, formatting helper

**Files:**

- Create: `src/components/ui/FloatingInput.tsx`
- Create: `src/components/ui/StatusBadge.tsx`
- Create: `src/lib/payment-status.ts`
- Test: `tests/components/ui/status-badge.test.tsx`

> If Phase 6 already created `src/components/ui/StatusBadge.tsx` or `src/lib/payment-status.ts`, skip creating that file and reuse it; only add anything missing. The component must render a text label + dot (status never by color alone).

**Interfaces:**

- Produces:

  ```typescript
  // src/lib/payment-status.ts
  export type StatusTone = "settled" | "pending" | "failed" | "neutral";
  export function statusLabel(s: PaymentStatus): string;     // "Settled", "Pending Trade", "Failed", …
  export function statusTone(s: PaymentStatus): StatusTone;   // SETTLED→settled; PENDING_*/in-flight→pending; FAILED→failed
  // src/components/ui/FloatingInput.tsx
  export const FloatingInput: React.ForwardRefExoticComponent<…>; // props: { label: string; id: string } & input attrs
  // src/components/ui/StatusBadge.tsx
  export function StatusBadge({ status }: { status: PaymentStatus }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test** — `tests/components/ui/status-badge.test.tsx`

```typescript
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StatusBadge } from "@/components/ui/StatusBadge";

it("renders a textual settled label with a dot", () => {
  render(<StatusBadge status="SETTLED" />);
  expect(screen.getByText("Settled")).toBeInTheDocument();
  expect(screen.getByTestId("status-dot")).toBeInTheDocument();
});

it("renders pending tone for an in-flight trade", () => {
  render(<StatusBadge status="PDAX_TRADING" />);
  expect(screen.getByText("Pending Trade")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/components/ui/status-badge.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/payment-status.ts`**

```typescript
import type { PaymentStatus } from "@/generated/prisma";

export type StatusTone = "settled" | "pending" | "failed" | "neutral";

const LABELS: Record<PaymentStatus, string> = {
  CREATED: "Created",
  QUOTED: "Quoted",
  AUTHORIZED: "Authorized",
  STELLAR_SUBMITTED: "Submitting",
  STELLAR_CONFIRMED: "Confirmed",
  PDAX_TRADING: "Pending Trade",
  PDAX_TRADED: "Traded",
  PAYOUT_SUBMITTED: "Paying Out",
  SETTLED: "Settled",
  FAILED: "Failed",
  REFUND_PENDING: "Refund Pending",
  REFUNDED: "Refunded",
};

export function statusLabel(s: PaymentStatus): string {
  return LABELS[s];
}

export function statusTone(s: PaymentStatus): StatusTone {
  if (s === "SETTLED") return "settled";
  if (s === "FAILED" || s === "REFUND_PENDING" || s === "REFUNDED") return "failed";
  if (s === "CREATED" || s === "QUOTED") return "neutral";
  return "pending";
}
```

- [ ] **Step 4: Implement `src/components/ui/StatusBadge.tsx`**

```tsx
import type { PaymentStatus } from "@/generated/prisma";
import { statusLabel, statusTone, type StatusTone } from "@/lib/payment-status";

const TONE: Record<StatusTone, { chip: string; dot: string; pulse: boolean }> = {
  settled: { chip: "bg-primary/10 text-primary", dot: "bg-primary", pulse: false },
  pending: { chip: "bg-secondary/10 text-secondary", dot: "bg-secondary", pulse: true },
  failed: { chip: "bg-error/10 text-error", dot: "bg-error", pulse: false },
  neutral: {
    chip: "bg-surface-container-high text-on-surface-variant",
    dot: "bg-outline",
    pulse: false,
  },
};

export function StatusBadge({ status }: { status: PaymentStatus }) {
  const tone = TONE[statusTone(status)];
  return (
    <span
      className={`inline-flex items-center gap-stack-sm rounded-full px-3 py-1 text-label-md ${tone.chip}`}
    >
      <span
        data-testid="status-dot"
        className={`h-1.5 w-1.5 rounded-full ${tone.dot} ${tone.pulse ? "motion-safe:animate-pulse" : ""}`}
      />
      {statusLabel(status)}
    </span>
  );
}
```

- [ ] **Step 5: Implement `src/components/ui/FloatingInput.tsx`**

```tsx
"use client";
import { forwardRef } from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & { label: string; id: string };

export const FloatingInput = forwardRef<HTMLInputElement, Props>(function FloatingInput(
  { label, id, className = "", ...rest },
  ref,
) {
  return (
    <div className="relative">
      <input
        id={id}
        ref={ref}
        placeholder=" "
        className={`peer w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-4 pb-2 pt-6 text-body-md text-on-surface placeholder-transparent focus:border-primary focus:outline-none focus:ring-4 focus:ring-primary/10 ${className}`}
        {...rest}
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-4 top-2 text-label-md uppercase tracking-wide text-on-surface-variant transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-body-md peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-focus:top-2 peer-focus:text-label-md peer-focus:uppercase peer-focus:tracking-wide peer-focus:text-primary"
      >
        {label}
      </label>
    </div>
  );
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run tests/components/ui/status-badge.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/FloatingInput.tsx src/components/ui/StatusBadge.tsx src/lib/payment-status.ts tests/components/ui/status-badge.test.tsx
git commit -m "feat(ui): FloatingInput + StatusBadge primitives + payment-status helpers"
```

---

### Task 9: Merchant layout — SideNav, mobile bottom nav, setup banner

**Files:**

- Create: `src/app/(merchant)/layout.tsx`
- Create: `src/components/merchant/SideNav.tsx`
- Create: `src/components/merchant/MobileNav.tsx`
- Create: `src/components/merchant/SetupBanner.tsx`
- Test: `tests/e2e/merchant-shell.spec.ts`

**Interfaces:**

- Consumes: `requireRole` (`@/server/auth/sessions`), `getMerchantForUserOrNull`/`merchantSetupState` (`@/server/merchant/service`).
- Produces: the `(merchant)` route-group shell. `SideNav` (lg+, `w-64`) + `MobileNav` (`h-16`, below `lg`) sharing one `MERCHANT_NAV` array; `SetupBanner` shown whenever `!setup.isComplete`.

- [ ] **Step 1: Write the failing Playwright test** — `tests/e2e/merchant-shell.spec.ts`

```typescript
import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers"; // Phase 2/6 helper: seeds a user, logs in, returns page authed

test("incomplete merchant sees the setup banner and nav", async ({ page }) => {
  await loginAs(page, { role: "MERCHANT", merchant: { status: "DRAFT", incomplete: true } });
  await page.goto("/merchant/dashboard");
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Finish setting up your business")).toBeVisible();
  await expect(page.getByRole("link", { name: /Complete onboarding/i })).toBeVisible();
});

test("active merchant does not see the setup banner", async ({ page }) => {
  await loginAs(page, { role: "MERCHANT", merchant: { status: "ACTIVE" } });
  await page.goto("/merchant/dashboard");
  await expect(page.getByText("Finish setting up your business")).toHaveCount(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm playwright test tests/e2e/merchant-shell.spec.ts`
Expected: FAIL — `/merchant/dashboard` 404 / no layout.

- [ ] **Step 3: Implement `src/components/merchant/SideNav.tsx`** (shared nav data + desktop rail)

```tsx
import Link from "next/link";

export const MERCHANT_NAV = [
  { href: "/merchant/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/merchant/transactions", label: "Transactions", icon: "history" },
  { href: "/merchant/qr", label: "My QR", icon: "qr_code_2" },
  { href: "/merchant/settings", label: "Settings", icon: "settings" },
] as const;

export function SideNav({ businessName, pathname }: { businessName: string; pathname: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-outline-variant bg-surface-container-low p-stack-lg lg:flex">
      <div className="mb-stack-lg flex items-center gap-stack-sm">
        <span className="material-symbols-outlined icon-filled text-primary">
          account_balance_wallet
        </span>
        <span className="text-headline-md font-bold text-primary">HeyPay</span>
      </div>
      <div className="mb-stack-lg rounded-lg bg-surface-container p-stack-md">
        <p className="text-label-md uppercase text-on-surface-variant">Business</p>
        <p className="truncate text-body-md font-medium text-on-surface">{businessName}</p>
      </div>
      <nav className="flex flex-1 flex-col gap-stack-sm" aria-label="Merchant">
        {MERCHANT_NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-11 items-center gap-stack-md rounded-lg px-stack-md py-stack-sm text-body-md transition-colors ${
                active
                  ? "bg-primary-container font-semibold text-on-primary-container"
                  : "text-on-surface-variant hover:bg-surface-container-high"
              }`}
            >
              <span className={`material-symbols-outlined ${active ? "icon-filled" : ""}`}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-stack-lg flex flex-col gap-stack-sm border-t border-outline-variant pt-stack-md">
        <Link
          href="/merchant/settings"
          className="flex min-h-11 items-center gap-stack-md px-stack-md py-stack-sm text-body-md text-on-surface-variant hover:bg-surface-container-high"
        >
          <span className="material-symbols-outlined">support_agent</span>Support
        </Link>
        <form action="/api/auth/logout" method="post">
          <button className="flex min-h-11 w-full items-center gap-stack-md px-stack-md py-stack-sm text-body-md text-error hover:bg-surface-container-high">
            <span className="material-symbols-outlined">logout</span>Log out
          </button>
        </form>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Implement `src/components/merchant/MobileNav.tsx`**

```tsx
import Link from "next/link";
import { MERCHANT_NAV } from "./SideNav";

export function MobileNav({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Merchant"
      className="glass fixed inset-x-0 bottom-0 z-40 flex h-16 items-stretch border-t border-outline-variant lg:hidden"
    >
      {MERCHANT_NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-label-md ${
              active ? "text-primary" : "text-on-surface-variant"
            }`}
          >
            <span className={`material-symbols-outlined ${active ? "icon-filled" : ""}`}>
              {item.icon}
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 5: Implement `src/components/merchant/SetupBanner.tsx`**

```tsx
import Link from "next/link";
import type { SetupState } from "@/server/merchant/service";

export function SetupBanner({ setup }: { setup: SetupState }) {
  if (setup.isComplete) return null;
  const steps = [
    { done: setup.hasBusiness, label: "Business identity" },
    { done: setup.hasSettlement, label: "Settlement account" },
    { done: setup.hasQrph, label: "Link QRPH" },
  ];
  return (
    <div className="mb-stack-lg rounded-xl border border-secondary/30 bg-secondary-container/40 p-stack-lg">
      <div className="flex flex-wrap items-center justify-between gap-stack-md">
        <div>
          <p className="text-headline-md text-on-secondary-container">
            Finish setting up your business
          </p>
          <p className="text-body-sm text-on-surface-variant">
            Complete every step to start accepting payments.
          </p>
        </div>
        <Link
          href="/merchant/onboarding"
          className="inline-flex min-h-11 items-center gap-stack-sm rounded-full bg-secondary px-stack-lg py-stack-sm text-body-md font-semibold text-on-secondary transition-transform hover:-translate-y-0.5"
        >
          Complete onboarding
          <span className="material-symbols-outlined">arrow_forward</span>
        </Link>
      </div>
      <ul className="mt-stack-md flex flex-wrap gap-stack-md">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-stack-sm text-body-sm">
            <span
              className={`material-symbols-outlined ${s.done ? "icon-filled text-primary" : "text-outline"}`}
            >
              {s.done ? "check_circle" : "radio_button_unchecked"}
            </span>
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 6: Implement `src/app/(merchant)/layout.tsx`**

```tsx
import { headers } from "next/headers";
import { requireRole } from "@/server/auth/sessions";
import { getMerchantForUserOrNull, merchantSetupState } from "@/server/merchant/service";
import { SideNav } from "@/components/merchant/SideNav";
import { MobileNav } from "@/components/merchant/MobileNav";
import { SetupBanner } from "@/components/merchant/SetupBanner";

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUserOrNull(user.id);
  const pathname = (await headers()).get("x-pathname") ?? "";
  const setup = merchant
    ? merchantSetupState(merchant)
    : { hasBusiness: false, hasSettlement: false, hasQrph: false, isComplete: false };

  return (
    <div className="min-h-screen bg-background text-on-background">
      <SideNav businessName={merchant?.businessName || "Your business"} pathname={pathname} />
      <main className="px-margin-mobile pb-24 pt-stack-lg lg:ml-64 lg:px-margin-desktop lg:pb-stack-lg">
        <div className="mx-auto max-w-7xl">
          {/* Onboarding route renders its own focused shell; banner shown on all others. */}
          {!pathname.endsWith("/onboarding") && <SetupBanner setup={setup} />}
          {children}
        </div>
      </main>
      <MobileNav pathname={pathname} />
    </div>
  );
}
```

> Note: `x-pathname` is set by `proxy.ts` (Phase 2). If Phase 2 did not add it, add a one-line header injection there: `requestHeaders.set("x-pathname", req.nextUrl.pathname)`.

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm playwright test tests/e2e/merchant-shell.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(merchant)/layout.tsx" src/components/merchant/SideNav.tsx src/components/merchant/MobileNav.tsx src/components/merchant/SetupBanner.tsx tests/e2e/merchant-shell.spec.ts
git commit -m "feat(merchant): route-group layout with SideNav, mobile nav, setup banner"
```

---

### Task 10: Onboarding wizard — 4-step flow, progress bar, live payer preview

**Files:**

- Create: `src/app/(merchant)/merchant/onboarding/page.tsx`
- Create: `src/components/merchant/onboarding/OnboardingWizard.tsx`
- Create: `src/components/merchant/onboarding/ProgressBar.tsx`
- Create: `src/components/merchant/onboarding/PhonePreview.tsx`
- Create: `src/lib/client/upload.ts`
- Create: `src/lib/client/qr.ts`
- Test: `tests/components/merchant/onboarding-wizard.test.tsx`

**Interfaces:**

- Consumes: `FloatingInput`, `SUPPORTED_BANKS` (`@/server/merchant/banks`), `MerchantDto`/`SetupState` types.
- Produces:

  ```typescript
  // src/lib/client/upload.ts
  export async function presignAndUpload(file: File, prefix: "qrph" | "logo"): Promise<string>; // returns object key
  // src/lib/client/qr.ts
  export async function decodeImageToRaw(file: File): Promise<string>; // jsQR over a canvas; throws if no QR found
  // src/components/merchant/onboarding/ProgressBar.tsx
  export function ProgressBar({ step, total }: { step: number; total?: number }): JSX.Element;
  // src/components/merchant/onboarding/PhonePreview.tsx
  export function PhonePreview(props: {
    businessName: string;
    city?: string;
    bankLast4?: string;
    amount?: string;
  }): JSX.Element;
  // src/components/merchant/onboarding/OnboardingWizard.tsx
  export function OnboardingWizard({ initial }: { initial: MerchantDto | null }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test** — `tests/components/merchant/onboarding-wizard.test.tsx`

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OnboardingWizard } from "@/components/merchant/onboarding/OnboardingWizard";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(JSON.stringify({ merchant: { id: "m1", businessName: "Bean Co" } }), { status: 201 }),
  ));
});

it("shows 4 progress segments and a live preview that updates as you type", () => {
  render(<OnboardingWizard initial={null} />);
  expect(screen.getAllByTestId("progress-seg")).toHaveLength(4);
  const input = screen.getByLabelText(/Business name/i);
  fireEvent.change(input, { target: { value: "Bean Co" } });
  expect(screen.getByTestId("preview-name")).toHaveTextContent("Bean Co");
});

it("calls POST /api/merchant on step 1 continue", async () => {
  render(<OnboardingWizard initial={null} />);
  fireEvent.change(screen.getByLabelText(/Business name/i), { target: { value: "Bean Co" } });
  fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
  expect(fetch).toHaveBeenCalledWith("/api/merchant", expect.objectContaining({ method: "POST" }));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/components/merchant/onboarding-wizard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/client/upload.ts`**

```typescript
export async function presignAndUpload(file: File, prefix: "qrph" | "logo"): Promise<string> {
  const res = await fetch("/api/uploads/presign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prefix, contentType: file.type, maxBytes: 5_000_000 }),
  });
  if (!res.ok) throw new Error("Could not prepare upload");
  const { url, fields, key } = (await res.json()) as {
    url: string;
    fields: Record<string, string>;
    key: string;
  };
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));
  form.append("file", file);
  const up = await fetch(url, { method: "POST", body: form });
  if (!up.ok) throw new Error("Upload failed");
  return key;
}
```

- [ ] **Step 4: Implement `src/lib/client/qr.ts`**

```typescript
import jsQR from "jsqr";

export async function decodeImageToRaw(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(data, width, height);
  if (!result?.data) throw new Error("No QR code found in the image");
  return result.data;
}
```

- [ ] **Step 5: Implement `src/components/merchant/onboarding/ProgressBar.tsx`**

```tsx
export function ProgressBar({ step, total = 4 }: { step: number; total?: number }) {
  return (
    <div
      className="flex gap-stack-sm"
      role="progressbar"
      aria-valuenow={step}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-label={`Step ${step} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          data-testid="progress-seg"
          className={`h-1.5 flex-1 rounded-full ${i < step ? "bg-primary" : "bg-surface-container-high"}`}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Implement `src/components/merchant/onboarding/PhonePreview.tsx`**

```tsx
export function PhonePreview({
  businessName,
  city,
  bankLast4,
  amount,
}: {
  businessName: string;
  city?: string;
  bankLast4?: string;
  amount?: string;
}) {
  return (
    <div className="mx-auto w-[280px] rounded-xl border-8 border-on-surface/90 bg-background p-stack-md shadow-lg">
      <p className="mb-stack-md text-center text-label-md uppercase text-on-surface-variant">
        Payer preview
      </p>
      <div className="tonal-card rounded-lg p-stack-lg text-center">
        <span className="material-symbols-outlined icon-filled text-3xl text-primary">
          storefront
        </span>
        <p data-testid="preview-name" className="mt-stack-sm text-headline-md text-on-surface">
          {businessName || "Your business"}
        </p>
        <p className="text-body-sm text-on-surface-variant">{city || "City"}, PH</p>
        <div className="my-stack-md border-t border-outline-variant" />
        <p className="text-label-md uppercase text-on-surface-variant">Amount</p>
        <p className="text-display-lg text-primary">{amount ? `₱${amount}` : "₱0.00"}</p>
        <p className="mt-stack-sm font-mono text-mono-data text-on-surface-variant">
          Settles to •••• {bankLast4 || "0000"}
        </p>
        <button
          disabled
          className="mt-stack-md w-full rounded-full bg-primary py-3 text-body-md font-semibold text-on-primary opacity-90"
        >
          Pay with XLM
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Implement `src/components/merchant/onboarding/OnboardingWizard.tsx`**

```tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FloatingInput } from "@/components/ui/FloatingInput";
import { SUPPORTED_BANKS } from "@/server/merchant/banks";
import { presignAndUpload } from "@/lib/client/upload";
import { decodeImageToRaw } from "@/lib/client/qr";
import type { MerchantDto } from "@/server/merchant/service";
import { ProgressBar } from "./ProgressBar";
import { PhonePreview } from "./PhonePreview";

const JSON_HEADERS = { "content-type": "application/json" };
async function callApi(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: JSON_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? "Request failed");
  return data;
}

export function OnboardingWizard({ initial }: { initial: MerchantDto | null }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState(initial?.businessName ?? "");
  const [hasMerchant, setHasMerchant] = useState(Boolean(initial));
  const [bankCode, setBankCode] = useState(initial?.settlementBankCode ?? "");
  const [accountName, setAccountName] = useState(initial?.accountName ?? "");
  const [accountNumber, setAccountNumber] = useState("");
  const [last4, setLast4] = useState(initial?.accountNumberLast4 ?? "");
  const [qrphRaw, setQrphRaw] = useState(initial?.qrphRaw ?? "");
  const [qrName, setQrName] = useState(initial?.qrphMerchantName ?? "");
  const [qrCity, setQrCity] = useState(initial?.qrphMerchantCity ?? "");

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const submitStep1 = () =>
    run(async () => {
      if (hasMerchant) await callApi("/api/merchant/me", "PATCH", { businessName });
      else {
        await callApi("/api/merchant", "POST", { businessName });
        setHasMerchant(true);
      }
      setStep(2);
    });

  const submitStep2 = () =>
    run(async () => {
      await callApi("/api/merchant/settlement", "POST", { bankCode, accountName, accountNumber });
      setLast4(accountNumber.slice(-4));
      setStep(3);
    });

  const onQrFile = (file: File) =>
    run(async () => {
      const raw = await decodeImageToRaw(file);
      let imageKey: string | undefined;
      try {
        imageKey = await presignAndUpload(file, "qrph");
      } catch {
        imageKey = undefined;
      }
      const data = await callApi("/api/merchant/qrph", "POST", { raw, imageKey });
      setQrphRaw(raw);
      setQrName(data.merchant.qrphMerchantName ?? "");
      setQrCity(data.merchant.qrphMerchantCity ?? "");
    });

  const submitStep3 = () =>
    run(async () => {
      if (!qrphRaw) {
        await callApi("/api/merchant/qrph", "POST", { raw: qrphRaw });
      }
      setStep(4);
    });

  const goLive = () =>
    run(async () => {
      await callApi("/api/merchant/go-live", "POST");
      router.push("/merchant/dashboard");
    });

  return (
    <div className="grid gap-margin-desktop lg:grid-cols-[1fr_320px]">
      <div className="tonal-card rounded-xl p-stack-lg lg:p-margin-desktop">
        <p className="mb-stack-sm text-label-md uppercase text-on-surface-variant">
          Step {step} of 4
        </p>
        <ProgressBar step={step} />

        {error && (
          <p
            role="alert"
            className="mt-stack-md rounded-lg bg-error/10 px-stack-md py-stack-sm text-body-sm text-error"
          >
            {error}
          </p>
        )}

        <div className="mt-stack-lg flex flex-col gap-stack-lg">
          {step === 1 && (
            <>
              <h1 className="text-headline-lg-mobile lg:text-headline-lg">Business identity</h1>
              <FloatingInput
                id="businessName"
                label="Business name"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                autoComplete="organization"
              />
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-headline-lg-mobile lg:text-headline-lg">Settlement account</h1>
              <p className="text-body-sm text-on-surface-variant">
                PHP from each payment lands here.
              </p>
              <fieldset className="grid grid-cols-2 gap-stack-md">
                <legend className="mb-stack-sm text-label-md uppercase text-on-surface-variant">
                  Bank or wallet
                </legend>
                {SUPPORTED_BANKS.map((b) => (
                  <label
                    key={b.code}
                    className="flex min-h-11 cursor-pointer items-center gap-stack-md rounded-lg border-2 border-outline-variant p-stack-md has-[:checked]:border-primary has-[:checked]:bg-primary-container/30"
                  >
                    <input
                      type="radio"
                      name="bank"
                      value={b.code}
                      className="sr-only"
                      checked={bankCode === b.code}
                      onChange={() => setBankCode(b.code)}
                    />
                    <span className="material-symbols-outlined text-primary">account_balance</span>
                    <span className="text-body-sm font-medium">{b.name}</span>
                  </label>
                ))}
              </fieldset>
              <FloatingInput
                id="accountName"
                label="Account name"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                autoComplete="name"
              />
              <FloatingInput
                id="accountNumber"
                label="Account number"
                inputMode="numeric"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
              />
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="text-headline-lg-mobile lg:text-headline-lg">Link your QRPH</h1>
              <p className="text-body-sm text-on-surface-variant">
                Upload a photo of your existing QRPH standee.
              </p>
              <label className="relative flex h-48 cursor-pointer flex-col items-center justify-center gap-stack-sm overflow-hidden rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-low">
                <span className="material-symbols-outlined text-4xl text-primary">
                  qr_code_scanner
                </span>
                <span className="text-body-md">
                  {qrphRaw ? "QRPH linked — replace?" : "Upload QRPH image"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onQrFile(f);
                  }}
                />
                {busy && (
                  <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-primary motion-safe:animate-[scan_2s_linear_infinite]" />
                )}
              </label>
              {qrphRaw && (
                <p className="rounded-lg bg-primary/10 px-stack-md py-stack-sm text-body-sm text-primary">
                  Detected: {qrName || "merchant"} {qrCity ? `· ${qrCity}` : ""}
                </p>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="text-headline-lg-mobile lg:text-headline-lg">Review &amp; go live</h1>
              <dl className="flex flex-col gap-stack-md">
                <Row label="Business" value={businessName} />
                <Row label="Settlement" value={`${bankCode} •••• ${last4}`} />
                <Row label="QRPH" value={qrName || "Linked"} />
              </dl>
            </>
          )}
        </div>

        <div className="mt-margin-desktop flex items-center justify-between">
          {step > 1 ? (
            <button
              onClick={() => setStep(step - 1)}
              disabled={busy}
              className="min-h-11 rounded-full border-2 border-outline-variant px-stack-lg py-stack-sm text-body-md text-on-surface"
            >
              Back
            </button>
          ) : (
            <span />
          )}
          {step < 4 ? (
            <button
              disabled={busy}
              onClick={step === 1 ? submitStep1 : step === 2 ? submitStep2 : submitStep3}
              className="inline-flex min-h-11 items-center gap-stack-sm rounded-full bg-secondary px-stack-lg py-stack-sm text-body-md font-semibold text-on-secondary transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Continue"}
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={goLive}
              className="inline-flex min-h-11 items-center gap-stack-sm rounded-full bg-primary px-stack-lg py-stack-sm text-body-md font-semibold text-on-primary shadow-lg shadow-primary/20 disabled:opacity-60"
            >
              {busy ? "Going live…" : "Go live"}
              <span className="material-symbols-outlined icon-filled">verified</span>
            </button>
          )}
        </div>
      </div>

      <div className="hidden lg:block">
        <PhonePreview businessName={businessName} city={qrCity} bankLast4={last4} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface-container-low px-stack-md py-stack-sm">
      <dt className="text-label-md uppercase text-on-surface-variant">{label}</dt>
      <dd className="font-mono text-mono-data text-on-surface">{value}</dd>
    </div>
  );
}
```

- [ ] **Step 8: Implement `src/app/(merchant)/merchant/onboarding/page.tsx`**

```tsx
import { requireRole } from "@/server/auth/sessions";
import { getMerchantForUserOrNull, serializeMerchant } from "@/server/merchant/service";
import { OnboardingWizard } from "@/components/merchant/onboarding/OnboardingWizard";

export default async function OnboardingPage() {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUserOrNull(user.id);
  return (
    <div className="mx-auto max-w-5xl">
      <OnboardingWizard initial={merchant ? serializeMerchant(merchant) : null} />
    </div>
  );
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm vitest run tests/components/merchant/onboarding-wizard.test.tsx`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add "src/app/(merchant)/merchant/onboarding" src/components/merchant/onboarding src/lib/client tests/components/merchant/onboarding-wizard.test.tsx
git commit -m "feat(merchant): 4-step onboarding wizard with progress bar + live payer preview"
```

---

### Task 11: Merchant dashboard — earnings cards, transactions table, QR + bank card, support

**Files:**

- Create: `src/app/(merchant)/merchant/dashboard/page.tsx`
- Create: `src/components/merchant/EarningsCards.tsx`
- Create: `src/components/merchant/TransactionsTable.tsx`
- Create: `src/components/merchant/BusinessSummaryCard.tsx`
- Test: `tests/e2e/merchant-dashboard.spec.ts`

**Interfaces:**

- Consumes: `requireRole`, `getMerchantForUser`/`getMerchantEarnings`/`listMerchantTransactions` (service), `StatusBadge`, `displayPhp`/`displayXlm`/`dec` (`@/lib/money`).
- Produces: `EarningsCards({ earnings })`, `TransactionsTable({ items })`, `BusinessSummaryCard({ merchant })` — reused by Tasks 12/13.

- [ ] **Step 1: Write the failing Playwright test** — `tests/e2e/merchant-dashboard.spec.ts`

```typescript
import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

test("dashboard shows earnings and a settled transaction row", async ({ page }) => {
  await loginAs(page, {
    role: "MERCHANT",
    merchant: { status: "ACTIVE" },
    payments: [
      { status: "SETTLED", netSettledPhp: "150.00", amountXlm: "18.7500000", customer: "juan" },
    ],
  });
  await page.goto("/merchant/dashboard");
  await expect(page.getByText("Total Settled")).toBeVisible();
  await expect(page.getByText("₱150.00")).toBeVisible();
  await expect(page.getByText("Settled")).toBeVisible();
  await expect(page.getByText("juan")).toBeVisible();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm playwright test tests/e2e/merchant-dashboard.spec.ts`
Expected: FAIL — `/merchant/dashboard` 404.

- [ ] **Step 3: Implement `src/components/merchant/EarningsCards.tsx`**

```tsx
import { dec, displayPhp, displayXlm } from "@/lib/money";
import type { MerchantEarnings } from "@/server/merchant/service";

export function EarningsCards({ earnings }: { earnings: MerchantEarnings }) {
  const mom = earnings.momChangePct;
  const momUp = (mom ?? 0) >= 0;
  return (
    <div className="grid grid-cols-1 gap-stack-lg md:grid-cols-2">
      <div className="tonal-card rounded-xl p-stack-lg">
        <p className="text-label-md uppercase text-on-surface-variant">Total Settled</p>
        <p className="mt-stack-sm text-display-lg text-primary">
          {displayPhp(dec(earnings.totalSettledPhp))}
        </p>
        {mom !== null && (
          <p
            className={`mt-stack-sm inline-flex items-center gap-stack-sm text-body-sm ${momUp ? "text-primary" : "text-error"}`}
          >
            <span className="material-symbols-outlined text-base">
              {momUp ? "trending_up" : "trending_down"}
            </span>
            {momUp ? "+" : ""}
            {mom}% vs last month
          </p>
        )}
      </div>
      <div className="tonal-card rounded-xl p-stack-lg">
        <p className="text-label-md uppercase text-on-surface-variant">Pending XLM Trades</p>
        <p className="mt-stack-sm font-mono text-headline-md text-secondary">
          {displayXlm(dec(earnings.pendingXlm))}
        </p>
        <p className="mt-stack-sm inline-flex items-center gap-stack-sm text-body-sm text-on-surface-variant">
          <span className="h-1.5 w-1.5 rounded-full bg-secondary motion-safe:animate-pulse" />
          Converting to PHP
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `src/components/merchant/TransactionsTable.tsx`**

```tsx
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { MerchantTxItem } from "@/server/merchant/service";

export function TransactionsTable({ items }: { items: MerchantTxItem[] }) {
  if (items.length === 0) {
    return (
      <div className="tonal-card rounded-xl p-margin-desktop text-center text-body-md text-on-surface-variant">
        No transactions yet.
      </div>
    );
  }
  return (
    <div className="tonal-card overflow-hidden rounded-xl">
      <table className="w-full border-collapse">
        <thead className="bg-surface-container-low">
          <tr className="text-left text-label-md uppercase text-outline">
            <th className="px-stack-md py-stack-md">Customer</th>
            <th className="px-stack-md py-stack-md">Received</th>
            <th className="hidden px-stack-md py-stack-md md:table-cell">Settlement</th>
            <th className="px-stack-md py-stack-md">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id} className="border-t border-outline-variant">
              <td className="px-stack-md py-stack-md">
                <p className="text-body-md text-on-surface">{t.customer}</p>
                <p className="font-mono text-mono-data text-outline">{t.reference}</p>
              </td>
              <td className="px-stack-md py-stack-md">
                <p className="font-mono text-mono-data font-semibold text-on-surface">
                  {t.amountXlm} XLM
                </p>
                <p className="font-mono text-mono-data text-outline">≈ ₱{t.amountPhp}</p>
              </td>
              <td className="hidden px-stack-md py-stack-md font-mono text-mono-data text-on-surface md:table-cell">
                {t.netSettledPhp ? `₱${t.netSettledPhp}` : "—"}
              </td>
              <td className="px-stack-md py-stack-md">
                <StatusBadge status={t.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5: Implement `src/components/merchant/BusinessSummaryCard.tsx`**

```tsx
import Link from "next/link";
import type { MerchantDto } from "@/server/merchant/service";

export function BusinessSummaryCard({ merchant }: { merchant: MerchantDto }) {
  return (
    <div className="tonal-card flex flex-col gap-stack-md rounded-xl p-stack-lg">
      <div className="flex items-center gap-stack-md">
        <span className="material-symbols-outlined icon-filled text-primary">qr_code_2</span>
        <p className="text-headline-md">Business QR &amp; settlement</p>
      </div>
      <div className="rounded-lg bg-surface-container-low p-stack-md">
        <p className="text-label-md uppercase text-on-surface-variant">Settles to</p>
        <p className="font-mono text-mono-data text-on-surface">
          {merchant.settlementBankName} •••• {merchant.accountNumberLast4}
        </p>
      </div>
      <Link
        href="/merchant/qr"
        className="inline-flex min-h-11 items-center justify-center gap-stack-sm rounded-lg border-2 border-primary px-stack-md py-stack-sm text-body-md font-medium text-primary"
      >
        View &amp; share QR
        <span className="material-symbols-outlined">arrow_forward</span>
      </Link>
    </div>
  );
}
```

- [ ] **Step 6: Implement `src/app/(merchant)/merchant/dashboard/page.tsx`**

```tsx
import Link from "next/link";
import { requireRole } from "@/server/auth/sessions";
import {
  getMerchantForUser,
  getMerchantEarnings,
  listMerchantTransactions,
  serializeMerchant,
} from "@/server/merchant/service";
import { EarningsCards } from "@/components/merchant/EarningsCards";
import { TransactionsTable } from "@/components/merchant/TransactionsTable";
import { BusinessSummaryCard } from "@/components/merchant/BusinessSummaryCard";

export default async function MerchantDashboard() {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUser(user.id);
  const [earnings, txPage] = await Promise.all([
    getMerchantEarnings(merchant.id),
    listMerchantTransactions(merchant.id, { limit: 8 }),
  ]);

  return (
    <div className="flex flex-col gap-stack-lg">
      <h1 className="text-headline-lg-mobile lg:text-headline-lg">Dashboard</h1>
      <EarningsCards earnings={earnings} />
      <div className="grid grid-cols-1 gap-stack-lg lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="mb-stack-md flex items-center justify-between">
            <h2 className="text-headline-md">Business transactions</h2>
            <Link href="/merchant/transactions" className="text-body-sm text-primary">
              View all
            </Link>
          </div>
          <TransactionsTable items={txPage.items} />
        </section>
        <div className="flex flex-col gap-stack-lg">
          <BusinessSummaryCard merchant={serializeMerchant(merchant)} />
          <div className="tonal-card flex flex-col gap-stack-sm rounded-xl p-stack-lg">
            <div className="flex items-center gap-stack-md">
              <span className="material-symbols-outlined text-primary">support_agent</span>
              <p className="text-headline-md">Need help?</p>
            </div>
            <p className="text-body-sm text-on-surface-variant">
              Our team is here for settlement or QR questions.
            </p>
            <Link href="/merchant/settings" className="text-body-sm font-medium text-primary">
              Contact support
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm playwright test tests/e2e/merchant-dashboard.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(merchant)/merchant/dashboard" src/components/merchant/EarningsCards.tsx src/components/merchant/TransactionsTable.tsx src/components/merchant/BusinessSummaryCard.tsx tests/e2e/merchant-dashboard.spec.ts
git commit -m "feat(merchant): dashboard — earnings cards, transactions table, business + support cards"
```

---

### Task 12: Settlement history page + filters + CSV export

**Files:**

- Create: `src/app/(merchant)/merchant/transactions/page.tsx`
- Create: `src/components/merchant/TransactionFilters.tsx`
- Create: `src/app/api/merchant/transactions/export/route.ts`
- Create: `src/lib/csv.ts`
- Test: `tests/lib/csv.test.ts`
- Test: `tests/api/merchant/export.test.ts`

**Interfaces:**

- Consumes: `requireRole`, `parseQuery`, `txQuerySchema`, `listMerchantTransactions`/`allMerchantTransactions`/`getMerchantForUser`, `TransactionsTable`.
- Produces:

  ```typescript
  // src/lib/csv.ts
  export function toCsv(headers: string[], rows: (string | number | null)[][]): string; // RFC-4180 quoting
  // GET /api/merchant/transactions/export?status&from&to -> text/csv attachment
  // src/components/merchant/TransactionFilters.tsx
  export function TransactionFilters({
    status,
    from,
    to,
  }: {
    status?: string;
    from?: string;
    to?: string;
  }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing tests**

`tests/lib/csv.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { toCsv } from "@/lib/csv";

it("quotes fields containing commas, quotes, and newlines", () => {
  const csv = toCsv(
    ["a", "b"],
    [
      ["x,y", 'he said "hi"'],
      ["line\nbreak", null],
    ],
  );
  expect(csv).toBe('a,b\r\n"x,y","he said ""hi"""\r\n"line\nbreak",\r\n');
});
```

`tests/api/merchant/export.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../../helpers/db";
import { mockSession, seedMerchantUser, seedPayment } from "../../helpers/merchant";

const USER = { id: "", username: "biz", role: "MERCHANT" as const, isActive: true };
mockSession(USER);
const ctx = { params: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
});

it("returns a text/csv attachment of settlement rows", async () => {
  const { merchant, user } = await seedMerchantUser({});
  USER.id = user.id;
  await seedPayment(merchant.id, { status: "SETTLED", netSettledPhp: "10.00" });
  const { GET } = await import("@/app/api/merchant/transactions/export/route");
  const res = await GET(
    new NextRequest("http://localhost:3000/api/merchant/transactions/export?status=SETTLED", {
      method: "GET",
      headers: { origin: "http://localhost:3000" },
    }),
    ctx,
  );
  expect(res.headers.get("content-type")).toContain("text/csv");
  expect(res.headers.get("content-disposition")).toContain("attachment");
  const text = await res.text();
  expect(text).toContain("Reference,Customer");
  expect(text).toContain("SETTLED");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/lib/csv.test.ts tests/api/merchant/export.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/lib/csv.ts`**

```typescript
function cell(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const lines = [headers.map(cell).join(",")];
  for (const row of rows) lines.push(row.map(cell).join(","));
  return lines.join("\r\n") + "\r\n";
}
```

- [ ] **Step 4: Implement `src/app/api/merchant/transactions/export/route.ts`**

```typescript
import { route, parseQuery } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { txQuerySchema } from "@/lib/schemas/merchant";
import { allMerchantTransactions, getMerchantForUser } from "@/server/merchant/service";
import { toCsv } from "@/lib/csv";

export const GET = route(async (req) => {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUser(user.id);
  const { status, from, to } = parseQuery(req, txQuerySchema);
  const rows = await allMerchantTransactions(merchant.id, { status, from, to });

  const csv = toCsv(
    ["Reference", "Customer", "Received XLM", "Amount PHP", "Settled PHP", "Status", "Date"],
    rows.map((r) => [
      r.reference,
      r.customer,
      r.amountXlm,
      r.amountPhp,
      r.netSettledPhp,
      r.status,
      r.createdAt,
    ]),
  );
  const filename = `heypay-settlements-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
});
```

> `route()` returns `NextResponse`; a plain `Response` is acceptable for non-JSON. If the project's `route` wrapper requires `NextResponse`, wrap with `new NextResponse(csv, { … })` instead.

- [ ] **Step 5: Implement `src/components/merchant/TransactionFilters.tsx`**

```tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";

const STATUSES = ["", "SETTLED", "PDAX_TRADING", "PAYOUT_SUBMITTED", "FAILED", "REFUNDED"];

export function TransactionFilters({
  status,
  from,
  to,
}: {
  status?: string;
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("cursor");
    router.push(`/merchant/transactions?${next.toString()}`);
  }

  return (
    <form className="flex flex-wrap items-end gap-stack-md">
      <label className="flex flex-col gap-stack-sm text-label-md uppercase text-on-surface-variant">
        Status
        <select
          defaultValue={status ?? ""}
          onChange={(e) => update("status", e.target.value)}
          className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md text-body-md text-on-surface"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s || "All"}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-stack-sm text-label-md uppercase text-on-surface-variant">
        From
        <input
          type="date"
          defaultValue={from ?? ""}
          onChange={(e) => update("from", e.target.value)}
          className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md text-body-md"
        />
      </label>
      <label className="flex flex-col gap-stack-sm text-label-md uppercase text-on-surface-variant">
        To
        <input
          type="date"
          defaultValue={to ?? ""}
          onChange={(e) => update("to", e.target.value)}
          className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md text-body-md"
        />
      </label>
      <a
        href={`/api/merchant/transactions/export?${params.toString()}`}
        className="inline-flex min-h-11 items-center gap-stack-sm rounded-lg bg-primary px-stack-md py-stack-sm text-body-md font-medium text-on-primary"
      >
        <span className="material-symbols-outlined">download</span>Export CSV
      </a>
    </form>
  );
}
```

- [ ] **Step 6: Implement `src/app/(merchant)/merchant/transactions/page.tsx`**

```tsx
import Link from "next/link";
import { requireRole } from "@/server/auth/sessions";
import { listMerchantTransactions, getMerchantForUser } from "@/server/merchant/service";
import { txQuerySchema } from "@/lib/schemas/merchant";
import { TransactionsTable } from "@/components/merchant/TransactionsTable";
import { TransactionFilters } from "@/components/merchant/TransactionFilters";

export default async function MerchantTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUser(user.id);
  const sp = await searchParams;
  const q = txQuerySchema.parse({
    status: sp.status,
    from: sp.from,
    to: sp.to,
    cursor: sp.cursor,
    limit: 25,
  });
  const page = await listMerchantTransactions(merchant.id, q);

  const nextParams = new URLSearchParams();
  if (sp.status) nextParams.set("status", sp.status);
  if (sp.from) nextParams.set("from", sp.from);
  if (sp.to) nextParams.set("to", sp.to);
  if (page.nextCursor) nextParams.set("cursor", page.nextCursor);

  return (
    <div className="flex flex-col gap-stack-lg">
      <h1 className="text-headline-lg-mobile lg:text-headline-lg">Settlement history</h1>
      <TransactionFilters status={sp.status} from={sp.from} to={sp.to} />
      <TransactionsTable items={page.items} />
      {page.nextCursor && (
        <Link
          href={`/merchant/transactions?${nextParams.toString()}`}
          className="self-center rounded-full border-2 border-primary px-stack-lg py-stack-sm text-body-md text-primary"
        >
          Load more
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run tests/lib/csv.test.ts tests/api/merchant/export.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(merchant)/merchant/transactions" src/app/api/merchant/transactions/export src/components/merchant/TransactionFilters.tsx src/lib/csv.ts tests/lib/csv.test.ts tests/api/merchant/export.test.ts
git commit -m "feat(merchant): settlement history page with filters + CSV export"
```

---

### Task 13: Business QR page — render, download, share payment link

**Files:**

- Create: `src/app/(merchant)/merchant/qr/page.tsx`
- Create: `src/components/merchant/BusinessQrCard.tsx`
- Test: `tests/e2e/merchant-qr.spec.ts`

**Interfaces:**

- Consumes: `requireRole`, `getMerchantForUser`, `QRCode` (`qrcode`, server-side render to SVG string), `BusinessQrCard` (client: download + copy link).
- Produces: `BusinessQrCard({ qrSvg, paymentLink, businessName })`.

- [ ] **Step 1: Write the failing Playwright test** — `tests/e2e/merchant-qr.spec.ts`

```typescript
import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

test("qr page renders the code and a copyable payment link", async ({ page }) => {
  await loginAs(page, { role: "MERCHANT", merchant: { status: "ACTIVE" } });
  await page.goto("/merchant/qr");
  await expect(page.getByText("My Business QR")).toBeVisible();
  await expect(page.locator("svg").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Copy link/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Download/i })).toBeVisible();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm playwright test tests/e2e/merchant-qr.spec.ts`
Expected: FAIL — `/merchant/qr` 404.

- [ ] **Step 3: Implement `src/components/merchant/BusinessQrCard.tsx`**

```tsx
"use client";
import { useState } from "react";

export function BusinessQrCard({
  qrSvg,
  paymentLink,
  businessName,
}: {
  qrSvg: string;
  paymentLink: string;
  businessName: string;
}) {
  const [copied, setCopied] = useState(false);

  function download() {
    const blob = new Blob([qrSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${businessName.replace(/\s+/g, "-").toLowerCase()}-qrph.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copy() {
    await navigator.clipboard.writeText(paymentLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="tonal-card mx-auto flex max-w-lg flex-col items-center gap-stack-lg rounded-xl p-margin-desktop">
      <h1 className="text-headline-lg-mobile lg:text-headline-lg">My Business QR</h1>
      <p className="text-headline-md text-on-surface">{businessName}</p>
      <div
        className="w-64 rounded-xl border border-outline-variant bg-surface-container-lowest p-stack-lg [&_svg]:h-full [&_svg]:w-full"
        aria-label="Business QRPH code"
        dangerouslySetInnerHTML={{ __html: qrSvg }}
      />
      <div className="flex w-full items-center gap-stack-sm rounded-lg bg-surface-container-low px-stack-md py-stack-sm">
        <span className="truncate font-mono text-mono-data text-on-surface-variant">
          {paymentLink}
        </span>
      </div>
      <div className="flex w-full gap-stack-md">
        <button
          onClick={download}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-stack-sm rounded-full bg-primary px-stack-lg py-stack-sm text-body-md font-semibold text-on-primary shadow-lg shadow-primary/20"
        >
          <span className="material-symbols-outlined">download</span>Download
        </button>
        <button
          onClick={copy}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-stack-sm rounded-full border-2 border-primary px-stack-lg py-stack-sm text-body-md font-medium text-primary"
        >
          <span className="material-symbols-outlined">{copied ? "check" : "content_copy"}</span>
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `src/app/(merchant)/merchant/qr/page.tsx`**

```tsx
import QRCode from "qrcode";
import Link from "next/link";
import { requireRole } from "@/server/auth/sessions";
import { getMerchantForUser } from "@/server/merchant/service";
import { BusinessQrCard } from "@/components/merchant/BusinessQrCard";

export default async function MerchantQrPage() {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUser(user.id);

  if (!merchant.qrphRaw) {
    return (
      <div className="tonal-card mx-auto max-w-lg rounded-xl p-margin-desktop text-center">
        <p className="text-headline-md">No QRPH linked yet</p>
        <Link href="/merchant/onboarding" className="mt-stack-md inline-block text-primary">
          Link your QRPH
        </Link>
      </div>
    );
  }

  const qrSvg = await QRCode.toString(merchant.qrphRaw, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
  });
  const paymentLink = `${process.env.APP_URL ?? ""}/pay?m=${merchant.id}`;

  return (
    <BusinessQrCard qrSvg={qrSvg} paymentLink={paymentLink} businessName={merchant.businessName} />
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm playwright test tests/e2e/merchant-qr.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(merchant)/merchant/qr" src/components/merchant/BusinessQrCard.tsx tests/e2e/merchant-qr.spec.ts
git commit -m "feat(merchant): business QR page — render, download SVG, copy payment link"
```

---

### Task 14: Merchant settings — business name/logo, bank re-entry, re-link QRPH, password

**Files:**

- Create: `src/app/(merchant)/merchant/settings/page.tsx`
- Create: `src/components/merchant/SettingsForms.tsx`
- Test: `tests/components/merchant/settings-forms.test.tsx`

**Interfaces:**

- Consumes: `requireRole`, `getMerchantForUser`/`serializeMerchant`, `FloatingInput`, `SUPPORTED_BANKS`, `presignAndUpload`, `decodeImageToRaw`. Reuses existing endpoints: `PATCH /api/merchant/me` (name+logoKey), `POST /api/merchant/settlement`, `POST /api/merchant/qrph`, `POST /api/auth/password`.
- Produces: `SettingsForms({ merchant }: { merchant: MerchantDto })` — a client component with four independent save sections.

- [ ] **Step 1: Write the failing test** — `tests/components/merchant/settings-forms.test.tsx`

```typescript
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SettingsForms } from "@/components/merchant/SettingsForms";

const merchant = {
  id: "m1", businessName: "Bean Co", logoKey: null, status: "ACTIVE",
  qrphRaw: "RAW", qrphMerchantName: "BEAN CO", qrphMerchantCity: "CEBU",
  qrphMerchantId: "M1", qrphImageKey: null, qrphCountry: "PH", qrphCurrency: "608",
  settlementBankCode: "BPI", settlementBankName: "Bank of the Philippine Islands",
  accountName: "Ana", accountNumberLast4: "7890",
  createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z",
} as const;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ merchant }), { status: 200 })));
});

it("shows current last4 masked and PATCHes the business name", async () => {
  render(<SettingsForms merchant={merchant} />);
  expect(screen.getByText(/•••• 7890/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Business name/i), { target: { value: "New Co" } });
  fireEvent.click(screen.getByRole("button", { name: /Save business/i }));
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith("/api/merchant/me", expect.objectContaining({ method: "PATCH" })),
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/components/merchant/settings-forms.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/components/merchant/SettingsForms.tsx`**

```tsx
"use client";
import { useState } from "react";
import { FloatingInput } from "@/components/ui/FloatingInput";
import { SUPPORTED_BANKS } from "@/server/merchant/banks";
import { presignAndUpload } from "@/lib/client/upload";
import { decodeImageToRaw } from "@/lib/client/qr";
import type { MerchantDto } from "@/server/merchant/service";

const JSON_HEADERS = { "content-type": "application/json" };
async function call(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: JSON_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? "Request failed");
  return data;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="tonal-card flex flex-col gap-stack-md rounded-xl p-stack-lg">
      <h2 className="text-headline-md">{title}</h2>
      {children}
    </section>
  );
}

function Note({ msg }: { msg: { kind: "ok" | "err"; text: string } | null }) {
  if (!msg) return null;
  return (
    <p
      role="status"
      className={`rounded-lg px-stack-md py-stack-sm text-body-sm ${
        msg.kind === "ok" ? "bg-primary/10 text-primary" : "bg-error/10 text-error"
      }`}
    >
      {msg.text}
    </p>
  );
}

export function SettingsForms({ merchant }: { merchant: MerchantDto }) {
  const [businessName, setBusinessName] = useState(merchant.businessName);
  const [bankCode, setBankCode] = useState(merchant.settlementBankCode);
  const [accountName, setAccountName] = useState(merchant.accountName);
  const [accountNumber, setAccountNumber] = useState("");
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [note, setNote] = useState<Record<string, { kind: "ok" | "err"; text: string } | null>>({});

  const set = (key: string, kind: "ok" | "err", text: string) =>
    setNote((n) => ({ ...n, [key]: { kind, text } }));
  const guard = (key: string, fn: () => Promise<void>) => async () => {
    setNote((n) => ({ ...n, [key]: null }));
    try {
      await fn();
      set(key, "ok", "Saved");
    } catch (e) {
      set(key, "err", e instanceof Error ? e.message : "Failed");
    }
  };

  const saveBusiness = guard("biz", async () => {
    await call("/api/merchant/me", "PATCH", { businessName });
  });
  const onLogo = (f: File) =>
    guard("logo", async () => {
      const key = await presignAndUpload(f, "logo");
      await call("/api/merchant/me", "PATCH", { logoKey: key });
    })();
  const saveBank = guard("bank", async () => {
    await call("/api/merchant/settlement", "POST", { bankCode, accountName, accountNumber });
  });
  const onQr = (f: File) =>
    guard("qr", async () => {
      const raw = await decodeImageToRaw(f);
      let imageKey: string | undefined;
      try {
        imageKey = await presignAndUpload(f, "qrph");
      } catch {
        imageKey = undefined;
      }
      await call("/api/merchant/qrph", "POST", { raw, imageKey });
    })();
  const savePw = guard("pw", async () => {
    await call("/api/auth/password", "POST", pw);
    setPw({ currentPassword: "", newPassword: "" });
  });

  return (
    <div className="grid grid-cols-1 gap-stack-lg lg:grid-cols-2">
      <Section title="Business identity">
        <FloatingInput
          id="businessName"
          label="Business name"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
        />
        <label className="flex min-h-11 cursor-pointer items-center gap-stack-md rounded-lg border border-outline-variant px-stack-md py-stack-sm text-body-md text-on-surface-variant">
          <span className="material-symbols-outlined text-primary">image</span>
          {merchant.logoKey ? "Replace logo" : "Upload logo"}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onLogo(f);
            }}
          />
        </label>
        <Note msg={note.biz ?? note.logo ?? null} />
        <button
          onClick={saveBusiness}
          className="min-h-11 self-start rounded-full bg-primary px-stack-lg py-stack-sm text-body-md font-semibold text-on-primary"
        >
          Save business
        </button>
      </Section>

      <Section title="Settlement account">
        <p className="font-mono text-mono-data text-on-surface-variant">
          Current: {merchant.settlementBankName} •••• {merchant.accountNumberLast4}
        </p>
        <select
          value={bankCode}
          onChange={(e) => setBankCode(e.target.value)}
          className="min-h-11 rounded-lg border border-outline-variant bg-surface-container-lowest px-stack-md text-body-md"
        >
          {SUPPORTED_BANKS.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
        <FloatingInput
          id="settAccountName"
          label="Account name"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
        />
        <FloatingInput
          id="settAccountNumber"
          label="New account number"
          inputMode="numeric"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
        />
        <Note msg={note.bank ?? null} />
        <button
          onClick={saveBank}
          className="min-h-11 self-start rounded-full bg-primary px-stack-lg py-stack-sm text-body-md font-semibold text-on-primary"
        >
          Save bank
        </button>
      </Section>

      <Section title="QRPH">
        <p className="text-body-sm text-on-surface-variant">
          Linked: {merchant.qrphMerchantName ?? "—"}
        </p>
        <label className="flex min-h-11 cursor-pointer items-center gap-stack-md rounded-lg border border-outline-variant px-stack-md py-stack-sm text-body-md text-on-surface-variant">
          <span className="material-symbols-outlined text-primary">qr_code_scanner</span>Re-link
          QRPH
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onQr(f);
            }}
          />
        </label>
        <Note msg={note.qr ?? null} />
      </Section>

      <Section title="Change password">
        <FloatingInput
          id="currentPassword"
          label="Current password"
          type="password"
          value={pw.currentPassword}
          onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
          autoComplete="current-password"
        />
        <FloatingInput
          id="newPassword"
          label="New password"
          type="password"
          value={pw.newPassword}
          onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
          autoComplete="new-password"
        />
        <Note msg={note.pw ?? null} />
        <button
          onClick={savePw}
          className="min-h-11 self-start rounded-full bg-primary px-stack-lg py-stack-sm text-body-md font-semibold text-on-primary"
        >
          Update password
        </button>
      </Section>
    </div>
  );
}
```

- [ ] **Step 4: Implement `src/app/(merchant)/merchant/settings/page.tsx`**

```tsx
import { requireRole } from "@/server/auth/sessions";
import { getMerchantForUser, serializeMerchant } from "@/server/merchant/service";
import { SettingsForms } from "@/components/merchant/SettingsForms";

export default async function MerchantSettingsPage() {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUser(user.id);
  return (
    <div className="flex flex-col gap-stack-lg">
      <h1 className="text-headline-lg-mobile lg:text-headline-lg">Settings</h1>
      <SettingsForms merchant={serializeMerchant(merchant)} />
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run tests/components/merchant/settings-forms.test.tsx`
Expected: PASS.

- [ ] **Step 6: Final phase typecheck/lint + commit**

```bash
pnpm typecheck && pnpm lint
git add "src/app/(merchant)/merchant/settings" src/components/merchant/SettingsForms.tsx tests/components/merchant/settings-forms.test.tsx
git commit -m "feat(merchant): settings — business/logo, bank re-entry, re-link QRPH, password"
```

---

## Self-Review

**SPEC §5 merchant routes → tasks**

- `/merchant/onboarding` (4-step wizard, live preview) → Task 10.
- `/merchant/dashboard` (earnings + MoM, pending XLM, business txns table, business QR + bank, support card, setup banner) → Task 11 (+ banner from Task 9).
- `/merchant/transactions` (filters status/date + CSV) → Task 12.
- `/merchant/qr` (view/download + share link) → Task 13.
- `/merchant/settings` (name/logo, bank, re-link QRPH, password) → Task 14.
- Route-group shell (SideNav + mobile bottom nav, `requireRole(MERCHANT)`, setup banner) → Task 9.

**SPEC §6 merchant endpoint table → tasks**

- `POST /api/merchant` (step1 DRAFT) → Task 2.
- `GET /api/merchant/me`, `PATCH /api/merchant/me` → Task 2.
- `POST /api/merchant/settlement` (validate bank, encrypt account, last4) → Task 3.
- `POST /api/merchant/qrph` (decode + uniqueness + persist + S3 image verify) → Task 4.
- `POST /api/merchant/go-live` (completeness → ACTIVE / PENDING_REVIEW flag) → Task 5.
- `GET /api/merchant/transactions?status&from&to&cursor` → Task 6; CSV export route → Task 12.
- `GET /api/merchant/earnings` (totalSettledPhp, momChangePct, pendingXlm) → Task 6.
- `GET /api/merchant/qr` (qrphRaw + qrSvg + paymentLink) → Task 6.
- Onboarding chain + earnings aggregation **integration tests** → Tasks 3/4/5/6 (unit-level) and Task 7 (end-to-end chain).

**SPEC §8.3 onboarding flow** — `go-live` requires businessName + CRC-valid QRPH + settlement account; status → ACTIVE (or PENDING_REVIEW gate) → Task 5, exercised end-to-end in Task 7 and driven by the wizard in Task 10.

**SPEC §4 Merchant fields** — all `qrph*`, `settlement*`, `accountNumber`/`accountNumberLast4`, `logoKey`, `status` are written by Tasks 2–5 and serialized (sans `accountNumber`) by `serializeMerchant` (Task 1). Step-1 empty-string placeholder rationale documented (Conventions §2).

**AGENT §6 PII / uploads / authz** — bank `accountNumber` envelope-encrypted via `encryptSecret`, only `last4` exposed/displayed (Tasks 1, 3, 14; asserted in Task 3 test that plaintext never persists or serializes). Uploads use presign + `verifyUploadedObject` magic-byte check (Tasks 4, 10, 14). Ownership enforced: every handler does `requireRole("MERCHANT")` + scopes by `getMerchantForUser(session.id)`; every mutation calls `assertSameOrigin`.

**BRAND form/table patterns → tasks**

- Floating-label inputs (`peer`) → Task 8 `FloatingInput`, used in Tasks 10/14.
- 4-segment progress bar (filled = `primary`) → Task 10 `ProgressBar`.
- Radio-card bank selector with `has-[:checked]:border-primary` → Task 10 (and select in Task 14).
- Live phone-mockup payer preview updating as you type → Task 10 `PhonePreview` (test asserts `preview-name` updates).
- Table: `bg-surface-container-low` header, `label-md` headers, `mono-data` amounts, paired XLM (bold) + PHP beneath → Task 11 `TransactionsTable`.
- Cards (`tonal-card`, `rounded-xl`), status badges (dot + text, settled=`primary/10`, pending=`secondary/10` + pulse) → Tasks 8/11.
- Buttons: `primary` pill CTAs with `shadow-primary/20`; secondary onboarding pill (`bg-secondary`, hover `-translate-y`) → Tasks 9/10/13/14.
- §8 a11y: visible focus rings (`focus:ring-4 focus:ring-primary/10`), real `<label>`s, `progressbar`/`aria-current`/`role="alert"`/`role="status"`, ≥44px tap targets (`min-h-11`), `motion-safe:` on pulse/scan → Tasks 8–14.

**Placeholder scan** — no "TBD/TODO/implement later"; every code step contains complete, runnable code; all referenced symbols are defined in this phase (Tasks 1, 8) or in the overview's Locked Shared Contracts (`route`, `json`, `parseBody`, `parseQuery`, `requireRole`, `assertSameOrigin`, `audit`, `encryptSecret`/`decryptSecret`, `decodeQrph`, `verifyUploadedObject`/`presignUpload`, `newPaymentReference`, money helpers, error constructors). Two clearly-flagged cross-phase assumptions (the `x-pathname` header from `proxy.ts`; the `loginAs`/`resetDb`/`prisma` test helpers from Phases 2/6) are noted inline with one-line remedies.

**Field-name consistency (Phase 5 + overview)** — uses `Merchant`/`Payment` field names verbatim from SPEC §4 (`qrphRaw`, `qrphMerchantName`, `qrphMerchantId`, `qrphAcquirerId`, `qrphMerchantCity`, `qrphCountry`, `qrphCurrency`, `qrphImageKey`, `settlementBankCode`, `settlementBankName`, `accountName`, `accountNumber`, `accountNumberLast4`, `netSettledPhp`, `amountXlm`, `amountPhp`, `reference`, `settledAt`, `status`). Consumes overview signatures unchanged; the only new shared types (`MerchantDto`, `SetupState`, `MerchantTxItem`, `MerchantTxPage`, `MerchantEarnings`, `PENDING_STATUSES`) are introduced and owned here (Task 1) and reused consistently across Tasks 2–14. `PaymentStatus` enum values match the overview state machine exactly.
