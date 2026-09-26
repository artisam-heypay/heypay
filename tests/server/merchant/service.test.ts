import { describe, it, expect, beforeEach } from "vitest";
import { resetDb } from "../../helpers/db";
import { seedMerchantUser, seedPayment } from "../../helpers/merchant";
import {
  serializeMerchant,
  merchantSetupState,
  getMerchantEarnings,
  parseEarningsRange,
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
  it("does not count a settlement account without a payout receipt email", async () => {
    const { merchant } = await seedMerchantUser({ payoutEmail: null });
    expect(merchantSetupState(merchant)).toMatchObject({ hasSettlement: false, isComplete: false });
  });
});

describe("getMerchantEarnings", () => {
  // 2026-09-26 14:00 in Manila (UTC+8).
  const NOW = new Date("2026-09-26T06:00:00Z");
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
  const settled = (merchantId: string, php: string, at: Date) =>
    seedPayment(merchantId, { status: "SETTLED", netSettledPhp: php, settledAt: at });

  it("totals only payouts inside the range and zero-fills daily buckets", async () => {
    const { merchant } = await seedMerchantUser({});
    await settled(merchant.id, "100.00", hoursAgo(1));
    await settled(merchant.id, "50.00", hoursAgo(72));
    await settled(merchant.id, "999.00", hoursAgo(24 * 10)); // outside the week

    const e = await getMerchantEarnings(merchant.id, "1w", NOW);
    expect(e.totalSettledPhp).toBe("150.00");
    expect(e.settledCount).toBe(2);
    expect(e.bucket).toBe("day");
    expect(e.series).toHaveLength(7);
    expect(e.series.at(-1)!.php).toBe("100.00"); // today
    expect(e.series.at(-4)!.php).toBe("50.00"); // three days ago
    expect(e.series.filter((p) => p.php === "0.00")).toHaveLength(5);
  });

  it("uses 24 hourly buckets for the last day", async () => {
    const { merchant } = await seedMerchantUser({});
    await settled(merchant.id, "20.00", hoursAgo(2));
    const e = await getMerchantEarnings(merchant.id, "1d", NOW);
    expect(e.bucket).toBe("hour");
    expect(e.series).toHaveLength(24);
    expect(e.totalSettledPhp).toBe("20.00");
  });

  it("buckets by Philippine day, not UTC day", async () => {
    const { merchant } = await seedMerchantUser({});
    // 2026-09-25 17:30 UTC is 2026-09-26 01:30 in Manila — today, not yesterday.
    await settled(merchant.id, "75.00", new Date("2026-09-25T17:30:00Z"));
    const e = await getMerchantEarnings(merchant.id, "1w", NOW);
    expect(e.series.at(-1)!.php).toBe("75.00");
    expect(e.series.at(-1)!.t).toBe("2026-09-25T16:00:00.000Z"); // Manila midnight
  });

  it("compares against the equally long period before", async () => {
    const { merchant } = await seedMerchantUser({});
    await settled(merchant.id, "150.00", hoursAgo(1));
    await settled(merchant.id, "100.00", hoursAgo(24 * 8)); // previous week
    const e = await getMerchantEarnings(merchant.id, "1w", NOW);
    expect(e.changePct).toBe(50);
    expect((await getMerchantEarnings(merchant.id, "all", NOW)).changePct).toBeNull();
  });

  it("counts pending payouts in PHP whatever coin paid them", async () => {
    const { merchant } = await seedMerchantUser({});
    await seedPayment(merchant.id, {
      status: "PAYOUT_SUBMITTED",
      asset: "XLM",
      amountPhp: "120.00",
    });
    await seedPayment(merchant.id, {
      status: "STELLAR_CONFIRMED",
      asset: "USDC",
      amountPhp: "80.00",
    });
    await seedPayment(merchant.id, {
      status: "SETTLED",
      netSettledPhp: "5.00",
      settledAt: hoursAgo(1),
    });
    const e = await getMerchantEarnings(merchant.id, "1m", NOW);
    expect(e.pendingPhp).toBe("200.00");
    expect(e.pendingCount).toBe(2);
    expect(PENDING_STATUSES).toContain("PAYOUT_SUBMITTED");
    expect(PENDING_STATUSES).not.toContain("PDAX_TRADING");
  });

  it("sizes 'all' from the first payout", async () => {
    const { merchant } = await seedMerchantUser({});
    await settled(merchant.id, "10.00", hoursAgo(24 * 5));
    const e = await getMerchantEarnings(merchant.id, "all", NOW);
    expect(e.bucket).toBe("day");
    expect(e.series.length).toBeGreaterThanOrEqual(6);
    expect(e.totalSettledPhp).toBe("10.00");
  });

  it("falls back to 1M for an unknown range value", () => {
    expect(parseEarningsRange("nonsense")).toBe("1m");
    expect(parseEarningsRange("1d")).toBe("1d");
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
