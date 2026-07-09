import { asAdmin, asPayer, makeRequest, seedUser, resetDb } from "./helpers";
import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "@/app/api/admin/users/route";
import { PATCH } from "@/app/api/admin/users/[id]/route";
import { prisma } from "@/server/db";

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
    const body = (await res.json()) as { items: { username: string; passwordHash?: string }[] };
    expect(body.items.map((u) => u.username)).toContain("alice");
    expect(body.items.every((u) => u.passwordHash === undefined)).toBe(true);
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
