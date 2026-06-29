import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { cookieJar } from "../../helpers/mock-cookies";
import { resetDb } from "../../helpers/db";
import { db } from "@/server/db";
import {
  SESSION_COOKIE,
  createSession,
  getSessionUser,
  requireRole,
  destroySession,
} from "@/server/auth/sessions";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function makeUser(role: "PAYER" | "ADMIN" = "PAYER") {
  return db.user.create({
    data: { username: `u_${Math.random().toString(36).slice(2)}`, passwordHash: "x", role },
  });
}

describe("sessions", () => {
  beforeEach(async () => {
    cookieJar.clear();
    await resetDb();
  });

  it("createSession persists only the token HASH and sets a cookie", async () => {
    const user = await makeUser();
    await createSession(user.id, { ip: "1.2.3.4", userAgent: "vitest" });

    const cookie = cookieJar.get(SESSION_COOKIE);
    expect(cookie?.value).toBeTruthy();

    const row = await db.session.findFirst({ where: { userId: user.id } });
    expect(row).toBeTruthy();
    expect(row!.tokenHash).toBe(sha256(cookie!.value)); // stored hash matches cookie
    expect(row!.tokenHash).not.toBe(cookie!.value); // raw token never stored
    expect(row!.ip).toBe("1.2.3.4");
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("getSessionUser returns the user for a valid cookie", async () => {
    const user = await makeUser();
    await createSession(user.id, {});
    const found = await getSessionUser();
    expect(found).toMatchObject({ id: user.id, role: "PAYER", isActive: true });
  });

  it("getSessionUser returns null when no cookie is present", async () => {
    expect(await getSessionUser()).toBeNull();
  });

  it("getSessionUser returns null for an expired session", async () => {
    const user = await makeUser();
    await createSession(user.id, {});
    await db.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await getSessionUser()).toBeNull();
  });

  it("requireRole throws forbidden on role mismatch", async () => {
    const user = await makeUser("PAYER");
    await createSession(user.id, {});
    await expect(requireRole("ADMIN")).rejects.toMatchObject({ status: 403 });
  });

  it("destroySession revokes the row and clears the cookie", async () => {
    const user = await makeUser();
    await createSession(user.id, {});
    await destroySession();
    expect(cookieJar.get(SESSION_COOKIE)).toBeUndefined();
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });
});
