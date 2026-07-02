import { asAdmin, makeRequest, seedPayment, resetDb } from "./helpers";
import { describe, it, expect, beforeEach } from "vitest";
import { GET as LIST } from "@/app/api/admin/payments/route";
import { GET as DETAIL } from "@/app/api/admin/payments/[id]/route";
import { dec } from "@/lib/money";

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
