import { asAdmin, makeRequest, seedPayment, resetDb } from "./helpers";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/admin/payments/[id]/retry/route";
import { prisma } from "@/server/db";
import { dec } from "@/lib/money";
import * as queues from "@/server/queue/queues";

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
    expect((event!.detail as { action: string }).action).toBe("admin.retry");
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
