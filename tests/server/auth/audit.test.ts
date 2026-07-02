import { describe, it, expect, vi, beforeEach } from "vitest";
import { db } from "@/server/db";
import { audit } from "@/server/auth/audit";
import { resetDb } from "../../helpers/db";

describe("audit", () => {
  beforeEach(async () => {
    await resetDb();
    vi.restoreAllMocks();
  });

  it("records the action with actor, target, and ip", async () => {
    const user = await db.user.create({
      data: { username: "audit-user", passwordHash: "x", role: "PAYER" },
    });
    await audit({ actorId: user.id, action: "auth.login", target: user.id, ip: "1.2.3.4" });
    const row = await db.auditLog.findFirst({ where: { action: "auth.login" } });
    expect(row).toMatchObject({ actorId: user.id, target: user.id, ip: "1.2.3.4" });
  });

  it("swallows database errors and never throws", async () => {
    vi.spyOn(db.auditLog, "create").mockRejectedValue(new Error("db down"));
    await expect(audit({ action: "auth.login.failed" })).resolves.toBeUndefined();
  });
});
