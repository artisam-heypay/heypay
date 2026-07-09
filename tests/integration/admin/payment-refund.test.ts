import { asAdmin, makeRequest, seedPayment, resetDb } from "./helpers";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/admin/payments/[id]/refund/route";
import { prisma } from "@/server/db";
import { dec } from "@/lib/money";
import * as queues from "@/server/queue/queues";

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
