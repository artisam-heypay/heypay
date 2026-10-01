import { describe, it, expect, beforeEach, vi } from "vitest";
import { cookieJar } from "../../helpers/mock-cookies";
import { resetDb } from "../../helpers/db";
import { NextRequest } from "next/server";

vi.mock("@/server/redis", async () => {
  const { makeFakeRedis } = await import("../../helpers/fake-redis");
  return { redis: makeFakeRedis() };
});

import { redis } from "@/server/redis";
import { db } from "@/server/db";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession, SESSION_COOKIE } from "@/server/auth/sessions";
import { GET as SESSION_GET } from "@/app/api/auth/session/route";
import { POST as LOGOUT_POST } from "@/app/api/auth/logout/route";
import { POST as PASSWORD_POST } from "@/app/api/auth/password/route";

const fake = redis as unknown as { _reset: () => void };

const ctx = { params: Promise.resolve({}) };
const post = (path: string, body?: unknown) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      origin: "http://localhost:3000",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
const get = (path: string) => new NextRequest(`http://localhost:3000${path}`, { method: "GET" });

async function login() {
  const user = await db.user.create({
    data: { username: "bob", passwordHash: await hashPassword("supersecret1"), role: "PAYER" },
  });
  await createSession(user.id, {});
  return user;
}

describe("session / logout / password", () => {
  beforeEach(async () => {
    cookieJar.clear();
    fake._reset();
    await resetDb();
  });

  it("GET /session returns null when logged out and the user when logged in", async () => {
    expect((await (await SESSION_GET(get("/api/auth/session"), ctx)).json()).user).toBeNull();
    await login();
    const res = await SESSION_GET(get("/api/auth/session"), ctx);
    expect((await res.json()).user).toMatchObject({ username: "bob" });
  });

  it("POST /logout returns 204, revokes the session row, and clears the cookie", async () => {
    const user = await login();
    const res = await LOGOUT_POST(post("/api/auth/logout"), ctx);
    expect(res.status).toBe(204);
    expect(cookieJar.get(SESSION_COOKIE)).toBeUndefined();
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("POST /password rejects a wrong current password with 401", async () => {
    await login();
    const res = await PASSWORD_POST(
      post("/api/auth/password", { currentPassword: "wrong", newPassword: "brandnew12" }),
      ctx,
    );
    expect(res.status).toBe(401);
  });

  it("POST /password changes the hash, revokes other sessions, and returns 204", async () => {
    const user = await login();
    const res = await PASSWORD_POST(
      post("/api/auth/password", { currentPassword: "supersecret1", newPassword: "brandnew12" }),
      ctx,
    );
    expect(res.status).toBe(204);
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(updated.passwordHash, "brandnew12")).toBe(true);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(1); // old revoked, one fresh
  });

  it("POST /password requires authentication (401 when logged out)", async () => {
    const res = await PASSWORD_POST(
      post("/api/auth/password", { currentPassword: "x", newPassword: "brandnew12" }),
      ctx,
    );
    expect(res.status).toBe(401);
  });
});
