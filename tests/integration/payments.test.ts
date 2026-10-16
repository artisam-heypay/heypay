import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { resetDb, makePayer, makeMerchant } from "../helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";

const { sessionUser } = vi.hoisted(() => ({
  sessionUser: {
    current: null as null | { id: string; username: string; role: "PAYER"; isActive: boolean },
  },
}));
vi.mock("@/server/auth/sessions", () => ({
  requireRole: vi.fn(async () => {
    if (!sessionUser.current) {
      const { AppError } = await import("@/lib/errors");
      throw new AppError("FORBIDDEN", "no", 403);
    }
    return sessionUser.current;
  }),
  requireUser: vi.fn(async () => {
    if (!sessionUser.current) {
      const { AppError } = await import("@/lib/errors");
      throw new AppError("UNAUTHORIZED", "no", 401);
    }
    return sessionUser.current;
  }),
}));
vi.mock("@/server/auth/rate-limit", () => ({ rateLimit: vi.fn(async () => {}) }));
vi.mock("@/server/stellar/wallet", () => ({
  walletService: {
    canReceive: async () => true,
    holdsOtherIssuer: async () => false,
    lockedXlm: async () => dec("0"),
  },
}));
vi.mock("@/server/rails", () => ({
  rail: {
    supportsAsset: () => true,
    minSellAmount: () => null,
    getDepositAddress: async () => ({ address: "GRAIL", memo: null }),
    getQuote: vi.fn(async ({ phpAmount }: { phpAmount: import("@/lib/money").Decimal }) => ({
      asset: "XLM" as const,
      rate: dec("12"),
      phpAmount,
      assetAmount: phpAmount.div(12),
      expiresAt: new Date(Date.now() + 90_000),
    })),
  },
}));
const { enqueueSettle } = vi.hoisted(() => ({ enqueueSettle: vi.fn(async (_id: string) => {}) }));
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
    sessionUser.current = null;
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
    expect(q.asset).toBe("XLM");
    expect(q.amountAsset).toBe("8.3333334");

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

  it("asks which coin to pay with when the wallet can pay in either, locking no price", async () => {
    process.env.PAYMENT_ASSETS = "XLM,USDC";
    try {
      const { user } = await makePayer({
        cachedXlm: "100.0000000",
        assets: { USDC: { cached: "50.0000000" } },
      });
      const { merchant } = await makeMerchant();
      sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };

      const res = await quote(
        new NextRequest("http://localhost/api/payments/quote", {
          method: "POST",
          headers: sameOrigin,
          body: JSON.stringify({ merchantId: merchant.id, amountPhp: "100", chooseAsset: true }),
        }),
        { params: Promise.resolve({}) },
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        choose: [
          { asset: "XLM", amountAsset: "8.3333334", available: "100.0000000" },
          { asset: "USDC", amountAsset: "8.3333334", available: "50.0000000" },
        ],
      });
      expect(await db.payment.count()).toBe(0);
    } finally {
      delete process.env.PAYMENT_ASSETS;
    }
  });

  it("starts in the only coin that can pay when asked to choose", async () => {
    process.env.PAYMENT_ASSETS = "XLM,USDC";
    try {
      const { user } = await makePayer({ cachedXlm: "100.0000000" });
      const { merchant } = await makeMerchant();
      sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };

      const res = await quote(
        new NextRequest("http://localhost/api/payments/quote", {
          method: "POST",
          headers: sameOrigin,
          body: JSON.stringify({ merchantId: merchant.id, amountPhp: "100", chooseAsset: true }),
        }),
        { params: Promise.resolve({}) },
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.asset).toBe("XLM");
      expect(body.paymentId).toBeTruthy();
    } finally {
      delete process.env.PAYMENT_ASSETS;
    }
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
        amountAsset: "8.3333334",
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
        amountAsset: "8.3333334",
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

  it("cancel an AUTHORIZED payment releases its reservation and marks CANCELLED; cannot cancel after STELLAR_SUBMITTED", async () => {
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
        amountAsset: "8.3333334",
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
    expect((await cRes.json()).status).toBe("CANCELLED");
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("0.0000000"); // reservation released on cancel

    const submitted = await db.payment.create({
      data: {
        reference: "TXN-DDDDDDDD",
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: "100.00",
        quotedRate: "12.00000000",
        amountAsset: "8.3333334",
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
