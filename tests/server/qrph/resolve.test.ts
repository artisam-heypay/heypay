import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` is hoisted above imports, so the spy is created via `vi.hoisted`.
const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/server/db", () => ({ prisma: { merchant: { findFirst } } }));

import { MerchantStatus } from "@/generated/prisma";
import type { QrphDecoded } from "@/server/qrph/decode";
import { resolveMerchant } from "@/server/qrph/resolve";

const decoded: QrphDecoded = {
  raw: "RAW-STRING",
  payloadFormat: "01",
  pointOfInit: "static",
  merchantId: "HEYPAY12345",
  acquirerId: "com.heypay",
  country: "PH",
  currency: "608",
  crcValid: true,
};

beforeEach(() => findFirst.mockReset());

describe("resolveMerchant", () => {
  it("returns the matching ACTIVE merchant", async () => {
    findFirst.mockResolvedValue({ id: "m1", businessName: "HeyPay Coffee" });
    const m = await resolveMerchant(decoded);
    expect(m).toEqual({ id: "m1", businessName: "HeyPay Coffee" });
    const where = findFirst.mock.calls[0]![0].where;
    expect(where.status).toBe(MerchantStatus.ACTIVE);
    expect(where.OR).toEqual(
      expect.arrayContaining([{ qrphRaw: "RAW-STRING" }, { qrphMerchantId: "HEYPAY12345" }]),
    );
  });

  it("returns null on a miss", async () => {
    findFirst.mockResolvedValue(null);
    expect(await resolveMerchant(decoded)).toBeNull();
  });

  it("matches by raw only when no merchantId is present", async () => {
    findFirst.mockResolvedValue(null);
    await resolveMerchant({ ...decoded, merchantId: undefined });
    expect(findFirst.mock.calls[0]![0].where.OR).toEqual([{ qrphRaw: "RAW-STRING" }]);
  });
});
