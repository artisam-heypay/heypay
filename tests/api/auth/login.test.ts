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
import { hashPassword } from "@/server/auth/password";
import { SESSION_COOKIE } from "@/server/auth/sessions";
import { POST } from "@/app/api/auth/login/route";

const fake = redis as unknown as { _reset: () => void };

const ctx = { params: Promise.resolve({}) };
const mk = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });

async function seedUser() {
  await db.user.create({
    data: { username: "alice", passwordHash: await hashPassword("supersecret1"), role: "PAYER" },
  });
}

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    cookieJar.clear();
    fake._reset();
    await resetDb();
    await seedUser();
  });

  it("logs in with correct credentials and sets a cookie", async () => {
    const res = await POST(mk({ username: "alice", password: "supersecret1" }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).user).toMatchObject({ username: "alice", role: "PAYER" });
    expect(cookieJar.get(SESSION_COOKIE)?.value).toBeTruthy();
  });

  it("returns the SAME generic 401 for wrong password and unknown user", async () => {
    const wrong = await POST(mk({ username: "alice", password: "nope" }), ctx);
    const unknown = await POST(mk({ username: "ghost", password: "whatever1" }), ctx);
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect((await wrong.json()).error.message).toBe((await unknown.json()).error.message);
  });

  it("logs in with the account's email, however it is capitalised", async () => {
    await db.user.update({
      where: { username: "alice" },
      data: { email: "alice@example.com", emailVerifiedAt: new Date() },
    });
    const res = await POST(mk({ username: "Alice@Example.com", password: "supersecret1" }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).user).toMatchObject({ username: "alice" });
  });

  it("gives a Google-only account, which has no password, the same generic 401", async () => {
    await db.user.create({
      data: { username: "gina", email: "gina@example.com", googleSub: "sub-1", role: "PAYER" },
    });
    const res = await POST(mk({ username: "gina@example.com", password: "anything1" }), ctx);
    const unknown = await POST(mk({ username: "ghost", password: "whatever1" }), ctx);
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toBe((await unknown.json()).error.message);
  });

  it("locks the account after repeated failures (429 on the 6th attempt)", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await POST(mk({ username: "alice", password: "wrongpw" }), ctx);
      expect(r.status).toBe(401);
    }
    const sixth = await POST(mk({ username: "alice", password: "supersecret1" }), ctx);
    expect(sixth.status).toBe(429); // locked even though the password is now correct
  });
});
