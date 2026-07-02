import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { advanceOnRailCallback } from "@/server/payments/state-machine";
import { prisma } from "@/server/db";

vi.mock("@/server/payments/state-machine", () => ({
  advanceOnRailCallback: vi.fn(async () => ({ status: "PDAX_TRADED" })),
}));
vi.mock("@/server/db", () => ({
  prisma: {
    idempotencyKey: { findUnique: vi.fn(), create: vi.fn(async () => ({})) },
    payment: { findFirst: vi.fn() },
  },
}));

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
    (advanceOnRailCallback as Mock).mockClear();
    (prisma.idempotencyKey.findUnique as Mock).mockReset().mockResolvedValue(null);
    (prisma.idempotencyKey.create as Mock).mockReset().mockResolvedValue({});
    (prisma.payment.findFirst as Mock)
      .mockReset()
      .mockResolvedValue({ id: "pay_1", pdaxTradeRef: "TRADE-REF-1" });
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
    expect(prisma.idempotencyKey.create).toHaveBeenCalledTimes(1);
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
    (prisma.idempotencyKey.findUnique as Mock).mockResolvedValueOnce({ key: "webhook.pdax:evt_1" });
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
    (prisma.payment.findFirst as Mock).mockResolvedValueOnce(null);
    const res = await POST(makeReq(validBody, sign(validBody)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, unmatched: true });
    expect(advanceOnRailCallback).not.toHaveBeenCalled();
    expect(prisma.idempotencyKey.create).toHaveBeenCalledTimes(1);
  });
});
