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

  async function merchant(name: string, data: { qrphRaw: string; qrphMerchantId?: string }) {
    const user = await db.user.create({
      data: { username: `u-${name}`, passwordHash: "x", role: "MERCHANT" },
    });
    return db.merchant.create({
      data: {
        userId: user.id,
        businessName: name,
        status: MerchantStatus.ACTIVE,
        settlementBankCode: "BPI",
        settlementBankName: "BPI",
        accountName: name,
        accountNumber: "encrypted",
        accountNumberLast4: "1234",
        ...data,
      },
    });
  }

  it("refuses to guess when two active merchants share the exact code", async () => {
    await merchant("A", { qrphRaw: "RAW-STRING" });
    await merchant("B", { qrphRaw: "RAW-STRING" });
    await expect(resolveMerchant(decoded)).rejects.toMatchObject({ status: 409 });
  });

  it("refuses to guess when two active merchants share the QR merchant id", async () => {
    await merchant("A", { qrphRaw: "OTHER-1", qrphMerchantId: "HEYPAY12345" });
    await merchant("B", { qrphRaw: "OTHER-2", qrphMerchantId: "HEYPAY12345" });
    await expect(resolveMerchant(decoded)).rejects.toMatchObject({ status: 409 });
  });

  it("prefers the exact code over a merchant-id match on someone else", async () => {
    await merchant("Owner", { qrphRaw: "RAW-STRING", qrphMerchantId: "HEYPAY12345" });
    await merchant("Lookalike", { qrphRaw: "OTHER", qrphMerchantId: "HEYPAY12345" });
    expect((await resolveMerchant(decoded))?.businessName).toBe("Owner");
  });

  it("ignores inactive merchants when deciding", async () => {
    await merchant("Live", { qrphRaw: "RAW-STRING" });
    const old = await merchant("Suspended", { qrphRaw: "RAW-STRING" });
    await db.merchant.update({ where: { id: old.id }, data: { status: MerchantStatus.SUSPENDED } });
    expect((await resolveMerchant(decoded))?.businessName).toBe("Live");
  });
});
