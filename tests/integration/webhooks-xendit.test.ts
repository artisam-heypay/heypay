import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, makePayer, makeMerchant } from "../helpers/db";
import { db } from "@/server/db";
import { newPaymentReference } from "@/server/payments/reference";

const { enqueueSettle } = vi.hoisted(() => ({ enqueueSettle: vi.fn(async (_id: string) => {}) }));
vi.mock("@/server/queue/queues", () => ({ enqueueSettle: (id: string) => enqueueSettle(id) }));

import { POST } from "@/app/api/webhooks/xendit/route";

const TOKEN = "xendit-callback-token";
process.env.XENDIT_CALLBACK_TOKEN = TOKEN;

function makeReq(
  body: unknown,
  headers: Record<string, string> = { "x-callback-token": TOKEN },
): NextRequest {
  return new NextRequest("http://localhost/api/webhooks/xendit", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: new Headers({ "content-type": "application/json", ...headers }),
  });
}

async function makeSubmittedPayment(payoutRef: string) {
  const { user } = await makePayer();
  const { merchant } = await makeMerchant();
  return db.payment.create({
    data: {
      reference: newPaymentReference(),
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: "100.00",
      quotedRate: "12.00000000",
      amountAsset: "8.3333334",
      networkFeeXlm: "0.0000100",
      status: "PAYOUT_SUBMITTED",
      payoutRef,
    },
  });
}

const succeeded = (id: string, reference_id?: string) => ({
  event: "payout.succeeded",
  business_id: "biz",
  created: new Date().toISOString(),
  data: { id, reference_id, status: "SUCCEEDED", amount: 100 },
});

describe("POST /api/webhooks/xendit", () => {
  beforeEach(async () => {
    enqueueSettle.mockClear();
    await resetDb();
  });

  it("nudges the settle job for the payout's payment", async () => {
    const payment = await makeSubmittedPayment("disb-1");
    const res = await POST(
      makeReq(succeeded("disb-1"), { "x-callback-token": TOKEN, "webhook-id": "wh_1" }),
    );

    expect(res.status).toBe(200);
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
    // The body's status is never applied directly — the settle job asks Xendit.
    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.status).toBe("PAYOUT_SUBMITTED");
  });

  it("falls back to the payment reference when the payout id is not recorded yet", async () => {
    const payment = await makeSubmittedPayment("disb-other");
    await POST(makeReq(succeeded("disb-unknown", payment.reference)));
    expect(enqueueSettle).toHaveBeenCalledWith(payment.id);
  });

  it("processes a redelivered callback only once", async () => {
    await makeSubmittedPayment("disb-2");
    const headers = { "x-callback-token": TOKEN, "webhook-id": "wh_dup" };
    await POST(makeReq(succeeded("disb-2"), headers));
    const again = await POST(makeReq(succeeded("disb-2"), headers));

    expect(await again.json()).toMatchObject({ ok: true, idempotent: true });
    expect(enqueueSettle).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a missing token", {}],
    ["a wrong token", { "x-callback-token": "nope" }],
  ])("rejects %s with 401", async (_label, headers) => {
    await makeSubmittedPayment("disb-3");
    const res = await POST(makeReq(succeeded("disb-3"), headers));
    expect(res.status).toBe(401);
    expect(enqueueSettle).not.toHaveBeenCalled();
  });

  it("rejects a malformed body with 400", async () => {
    const res = await POST(makeReq("{not json"));
    expect(res.status).toBe(400);
  });

  it("acknowledges an unmatched payout without failing, so Xendit stops retrying", async () => {
    const res = await POST(makeReq(succeeded("disb-nobody")));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, unmatched: true });
    expect(enqueueSettle).not.toHaveBeenCalled();
  });

  it("ignores events that are not about payouts", async () => {
    const res = await POST(makeReq({ event: "invoice.paid", data: { id: "inv-1" } }));
    expect(await res.json()).toMatchObject({ ok: true, ignored: true });
    expect(enqueueSettle).not.toHaveBeenCalled();
  });
});
