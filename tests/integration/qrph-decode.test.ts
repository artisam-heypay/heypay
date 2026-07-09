import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb, makePayer, makeMerchant } from "../helpers/db";

const { sessionUser } = vi.hoisted(() => ({
  sessionUser: {
    current: null as null | { id: string; username: string; role: "PAYER"; isActive: boolean },
  },
}));
vi.mock("@/server/auth/sessions", () => ({
  requireRole: vi.fn(async () => {
    if (!sessionUser.current) {
      const { AppError } = await import("@/lib/errors");
      throw new AppError("FORBIDDEN", "no", 403);
    }
    return sessionUser.current;
  }),
}));

const { decodeQrph, resolveMerchant } = vi.hoisted(() => ({
  decodeQrph: vi.fn(),
  resolveMerchant: vi.fn(),
}));
vi.mock("@/server/qrph/decode", () => ({
  decodeQrph: (raw: string) => decodeQrph(raw),
  decodeQrphImage: vi.fn(),
}));
vi.mock("@/server/qrph/resolve", () => ({ resolveMerchant: (d: unknown) => resolveMerchant(d) }));

import { POST as decode } from "@/app/api/qrph/decode/route";
const noParams = { params: Promise.resolve({}) };
const post = (body: unknown) =>
  new NextRequest("http://localhost/api/qrph/decode", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

describe("POST /api/qrph/decode", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    sessionUser.current = null;
    await resetDb();
  });

  it("decodes raw and returns the resolved merchant", async () => {
    const { user } = await makePayer();
    const { merchant } = await makeMerchant();
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
    decodeQrph.mockReturnValue({
      raw: "X",
      pointOfInit: "dynamic",
      currency: "608",
      country: "PH",
      crcValid: true,
      amountPhp: "100",
    });
    resolveMerchant.mockResolvedValue(merchant);

    const res = await decode(post({ raw: "X" }), noParams);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.decoded.amountPhp).toBe("100");
    expect(body.merchant).toMatchObject({ id: merchant.id, businessName: "Test Store" });
  });

  it("returns merchant: null when unresolved", async () => {
    const { user } = await makePayer();
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
    decodeQrph.mockReturnValue({
      raw: "X",
      pointOfInit: "static",
      currency: "608",
      country: "PH",
      crcValid: true,
    });
    resolveMerchant.mockResolvedValue(null);
    const res = await decode(post({ raw: "X" }), noParams);
    const body = await res.json();
    expect(body.merchant).toBeNull();
  });

  it("rejects a body with neither raw nor image (400)", async () => {
    const { user } = await makePayer();
    sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
    const res = await decode(post({}), noParams);
    expect(res.status).toBe(400);
  });
});
