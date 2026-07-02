import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/db";
import { db } from "@/server/db";
import { MerchantStatus } from "@/generated/prisma/client";
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

describe("resolveMerchant", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns the matching ACTIVE merchant", async () => {
    const user = await db.user.create({
      data: { username: "m-user", passwordHash: "x", role: "MERCHANT" },
    });
    await db.merchant.create({
      data: {
        userId: user.id,
        businessName: "HeyPay Coffee",
        status: MerchantStatus.ACTIVE,
        qrphRaw: "RAW-STRING",
        qrphMerchantId: "HEYPAY12345",
        settlementBankCode: "BPI",
        settlementBankName: "BPI",
        accountName: "HeyPay Coffee Inc.",
        accountNumber: "encrypted",
        accountNumberLast4: "1234",
      },
    });
    const m = await resolveMerchant(decoded);
    expect(m?.businessName).toBe("HeyPay Coffee");
  });

  it("returns null on a miss", async () => {
    expect(await resolveMerchant(decoded)).toBeNull();
  });

  it("matches by raw only when no merchantId is present", async () => {
    const user = await db.user.create({
      data: { username: "m-user2", passwordHash: "x", role: "MERCHANT" },
    });
    await db.merchant.create({
      data: {
        userId: user.id,
        businessName: "Raw Match",
        status: MerchantStatus.ACTIVE,
        qrphRaw: "RAW-STRING",
        settlementBankCode: "BPI",
        settlementBankName: "BPI",
        accountName: "Raw",
        accountNumber: "encrypted",
        accountNumberLast4: "1234",
      },
    });
    const m = await resolveMerchant({ ...decoded, merchantId: undefined });
    expect(m?.businessName).toBe("Raw Match");
  });
});
