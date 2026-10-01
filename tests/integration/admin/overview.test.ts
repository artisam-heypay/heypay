import { asAdmin, asPayer, makeRequest, seedPayment, resetDb } from "./helpers";
import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "@/app/api/admin/overview/route";
import { dec } from "@/lib/money";

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
      amountAsset: dec("10.0000000"),
      netSettledPhp: dec("98.50"),
    });
    await seedPayment({
      status: "SETTLED",
      amountPhp: dec("50.00"),
      amountAsset: dec("5.0000000"),
      netSettledPhp: dec("49.00"),
    });
    await seedPayment({
      status: "FAILED",
      amountPhp: dec("20.00"),
      amountAsset: dec("2.0000000"),
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
    expect(body.volume.totalXlm).toBe("15.0000000");
    expect(body.volume.totalPhpSettled).toBe("147.50");
    expect(body.recentFailures).toHaveLength(1);
    expect(body.recentFailures[0].failureReason).toBe("PDAX trade rejected");
  });
});
