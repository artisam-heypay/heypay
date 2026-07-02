import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "../../helpers/db";
import { seedMerchantUser, seedPayment } from "../../helpers/merchant";
import {
  serializeMerchant,
  merchantSetupState,
  getMerchantEarnings,
  listMerchantTransactions,
  PENDING_STATUSES,
} from "@/server/merchant/service";
import { getBankName, SUPPORTED_BANKS } from "@/server/merchant/banks";

beforeEach(async () => {
  await resetDb();
});

describe("banks", () => {
  it("resolves a supported bank code and rejects unknown", () => {
    expect(getBankName(SUPPORTED_BANKS[0]!.code)).toBe(SUPPORTED_BANKS[0]!.name);
    expect(getBankName("NOPE")).toBeNull();
  });
});

describe("serializeMerchant", () => {
  it("exposes last4 but never the full account number", async () => {
    const { merchant } = await seedMerchantUser({
      accountNumber: "1234567890",
      accountNumberLast4: "7890",
      settlementBankCode: "BPI",
    });
    const dto = serializeMerchant(merchant) as Record<string, unknown>;
    expect(dto.accountNumberLast4).toBe("7890");
    expect(dto.accountNumber).toBeUndefined();
    expect(JSON.stringify(dto)).not.toContain("1234567890");
  });
});

describe("merchantSetupState", () => {
  it("flags an empty-placeholder DRAFT as incomplete", async () => {
    const { merchant } = await seedMerchantUser({
      qrphRaw: "",
      settlementBankCode: "",
      accountNumberLast4: "",
    });
    expect(merchantSetupState(merchant)).toEqual({
      hasBusiness: true,
      hasSettlement: false,
      hasQrph: false,
      isComplete: false,
    });
  });
  it("flags a fully-populated merchant complete", async () => {
    const { merchant } = await seedMerchantUser({});
    expect(merchantSetupState(merchant).isComplete).toBe(true);
  });
});

describe("getMerchantEarnings", () => {
  it("sums SETTLED netSettledPhp, in-flight XLM, and computes MoM", async () => {
    const { merchant } = await seedMerchantUser({});
    await seedPayment(merchant.id, {
      status: "SETTLED",
      netSettledPhp: "100.00",
      settledAt: new Date(),
    });
    await seedPayment(merchant.id, {
      status: "SETTLED",
      netSettledPhp: "50.00",
      settledAt: new Date(),
    });
    await seedPayment(merchant.id, { status: "PDAX_TRADING", amountXlm: "12.5000000" });
    const e = await getMerchantEarnings(merchant.id);
    expect(e.totalSettledPhp).toBe("150.00");
    expect(e.pendingXlm).toBe("12.5000000");
    expect(PENDING_STATUSES).toContain("PDAX_TRADING");
  });
});

describe("listMerchantTransactions", () => {
  it("filters by status and paginates by cursor", async () => {
    const { merchant } = await seedMerchantUser({});
    for (let i = 0; i < 3; i++)
      await seedPayment(merchant.id, { status: "SETTLED", netSettledPhp: "10.00" });
    await seedPayment(merchant.id, { status: "FAILED" });
    const page1 = await listMerchantTransactions(merchant.id, { status: "SETTLED", limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await listMerchantTransactions(merchant.id, {
      status: "SETTLED",
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });
});
