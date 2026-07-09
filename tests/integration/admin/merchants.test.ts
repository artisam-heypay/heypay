import { asAdmin, makeRequest, seedMerchant, resetDb } from "./helpers";
import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "@/app/api/admin/merchants/route";
import { PATCH } from "@/app/api/admin/merchants/[id]/route";
import { prisma } from "@/server/db";

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
    expect((log?.metadata as { status: string }).status).toBe("ACTIVE");
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
