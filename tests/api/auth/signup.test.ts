import { describe, it, expect, beforeEach, vi } from "vitest";
import { cookieJar } from "../../helpers/mock-cookies";
import { resetDb } from "../../helpers/db";
import { NextRequest } from "next/server";

vi.mock("@/server/redis", async () => {
  const { makeFakeRedis } = await import("../../helpers/fake-redis");
  return { redis: makeFakeRedis() };
});
vi.mock("@/server/stellar/wallet", () => ({
  walletService: {
    generate: () => ({ publicKey: "GTEST", encryptedSecret: "v1:enc", secretKeyVersion: 1 }),
  },
}));

import { redis } from "@/server/redis";
import { db } from "@/server/db";
import { SESSION_COOKIE } from "@/server/auth/sessions";
import { POST } from "@/app/api/auth/signup/route";

const fake = redis as unknown as { _reset: () => void };

const ctx = { params: Promise.resolve({}) };
const mk = (body: unknown) =>
  new NextRequest("http://localhost:3000/api/auth/signup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });

describe("POST /api/auth/signup", () => {
  beforeEach(async () => {
    cookieJar.clear();
    fake._reset();
    await resetDb();
  });

  it("creates a MERCHANT (no wallet) and sets a session cookie", async () => {
    const res = await POST(
      mk({ username: "merchy", password: "supersecret1", role: "MERCHANT" }),
      ctx,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user).toMatchObject({ username: "merchy", role: "MERCHANT" });
    expect(cookieJar.get(SESSION_COOKIE)?.value).toBeTruthy();
    expect(await db.custodialWallet.count()).toBe(0);
  });

  it("creates a PAYER and provisions a custodial wallet", async () => {
    const res = await POST(
      mk({ username: "payer1", password: "supersecret1", role: "PAYER" }),
      ctx,
    );
    expect(res.status).toBe(201);
    const user = await db.user.findUniqueOrThrow({ where: { username: "payer1" } });
    const wallet = await db.custodialWallet.findUnique({ where: { userId: user.id } });
    expect(wallet?.stellarPublicKey).toBe("GTEST");
    expect(wallet?.encryptedSecret).toBe("v1:enc");
  });

  it("rejects a duplicate username with 409", async () => {
    await POST(mk({ username: "dupe", password: "supersecret1", role: "PAYER" }), ctx);
    const res = await POST(mk({ username: "dupe", password: "supersecret1", role: "PAYER" }), ctx);
    expect(res.status).toBe(409);
  });

  it("rejects an invalid role with 400", async () => {
    const res = await POST(
      mk({ username: "adminwannabe", password: "supersecret1", role: "ADMIN" }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a too-short password with 400", async () => {
    const res = await POST(mk({ username: "shorty", password: "123", role: "PAYER" }), ctx);
    expect(res.status).toBe(400);
  });
});
