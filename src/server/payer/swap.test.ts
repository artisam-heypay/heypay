import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, makePayer } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { AppError } from "@/lib/errors";

const { findStrictSendPaths, findConversionRoute, canReceive, lockedXlm, swap, swapOutcome } =
  vi.hoisted(() => ({
    findStrictSendPaths: vi.fn(),
    findConversionRoute: vi.fn(),
    canReceive: vi.fn(),
    lockedXlm: vi.fn(),
    swap: vi.fn(),
    swapOutcome: vi.fn(),
  }));

vi.mock("@/server/stellar/paths", () => ({
  findStrictSendPaths: (...args: unknown[]) => findStrictSendPaths(...args),
  findConversionRoute: (...args: unknown[]) => findConversionRoute(...args),
}));
vi.mock("@/server/stellar/wallet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/stellar/wallet")>()),
  walletService: {
    canReceive: (pk: string, asset: string) => canReceive(pk, asset),
    lockedXlm: (pk: string) => lockedXlm(pk),
    swap: (input: unknown) => swap(input),
    swapOutcome: (txHash: string, sentBy: Date) => swapOutcome(txHash, sentBy),
  },
}));

import { SwapOutcomeUnknownError } from "@/server/stellar/wallet";
import {
  executeSwap,
  getPayerSwaps,
  getRecentSwaps,
  quoteSwap,
  resolveUnconfirmedSwaps,
} from "./swap";

const HASH = "a".repeat(64);
const FEE = "0.0000100";

/** The swap error for a call that must be refused, with its `reason`. */
async function refusal(call: Promise<unknown>): Promise<{ status: number; reason?: string }> {
  const err = await call.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  const app = err as AppError;
  return { status: app.status, reason: (app.details as { reason?: string } | undefined)?.reason };
}

async function balancesOf(walletId: string) {
  const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: walletId } });
  const usdc = await db.walletBalance.findUnique({
    where: { walletId_asset: { walletId, asset: "USDC" } },
  });
  return {
    xlm: w.cachedXlmBalance.toFixed(7),
    xlmHeld: w.reservedXlm.toFixed(7),
    usdc: usdc?.cached.toFixed(7) ?? "0.0000000",
    usdcHeld: usdc?.reserved.toFixed(7) ?? "0.0000000",
  };
}

async function ledger(walletId: string) {
  const rows = await db.walletTransaction.findMany({ where: { walletId }, orderBy: { id: "asc" } });
  return rows.map((r) => ({
    type: r.type,
    asset: r.asset,
    amount: r.amount.toFixed(7),
    balanceAfter: r.balanceAfter.toFixed(7),
    hash: r.stellarTxHash,
    memo: r.memo,
  }));
}

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  process.env.PAYMENT_ASSETS = "XLM,USDC";
  canReceive.mockResolvedValue(true);
  lockedXlm.mockResolvedValue(dec("1.5"));
  findStrictSendPaths.mockResolvedValue([{ destAmount: dec("9.4458598"), path: [] }]);
  findConversionRoute.mockResolvedValue({ sourceAmount: dec("0.9900000"), path: [] });
});
afterEach(() => {
  delete process.env.PAYMENT_ASSETS;
});

describe("quoteSwap", () => {
  it("quotes XLM to USDC as a strict send, with 1% taken off for the minimum", async () => {
    const quote = await quoteSwap("XLM", dec("10"));
    expect(findStrictSendPaths).toHaveBeenCalledWith("XLM", "USDC", dec("10"));
    expect(quote).toMatchObject({ from: "XLM", to: "USDC", mode: "strict_send" });
    expect(quote.estimated.toFixed(7)).toBe("9.4458598");
    // 9.4458598 × 0.99 = 9.351401202, rounded down so the payer is never promised more.
    expect(quote.minReceived.toFixed(7)).toBe("9.3514012");
  });

  it("quotes USDC to XLM as a strict receive", async () => {
    findStrictSendPaths.mockResolvedValue([{ destAmount: dec("6.9753911"), path: [] }]);
    const quote = await quoteSwap("USDC", dec("1"));
    expect(findStrictSendPaths).toHaveBeenCalledWith("USDC", "XLM", dec("1"));
    expect(quote).toMatchObject({ from: "USDC", to: "XLM", mode: "strict_receive" });
    expect(quote.minReceived.toFixed(7)).toBe("6.9056371");
  });

  it("refuses an amount the DEX has no route for", async () => {
    findStrictSendPaths.mockResolvedValue([]);
    expect(await refusal(quoteSwap("XLM", dec("10")))).toEqual({ status: 409, reason: "no_route" });
  });

  it("is not available while USDC is not an enabled asset", async () => {
    process.env.PAYMENT_ASSETS = "XLM";
    expect((await refusal(quoteSwap("XLM", dec("10")))).status).toBe(400);
  });
});

describe("executeSwap", () => {
  it("swaps XLM for USDC with a strict send and records what the chain says moved", async () => {
    const { user, wallet } = await makePayer({
      cachedXlm: "100.0000000",
      assets: { USDC: { cached: "2.0000000" } },
    });
    // The chain delivered more than the minimum the payer was promised.
    swap.mockResolvedValue({
      txHash: HASH,
      ok: true,
      sent: dec("10"),
      received: dec("9.4458598"),
      feeXlm: dec(FEE),
      failure: null,
    });

    const out = await executeSwap({
      userId: user.id,
      from: "XLM",
      amount: dec("10"),
      minReceived: dec("9.3514012"),
    });

    expect(swap).toHaveBeenCalledWith({
      encryptedSecret: wallet.encryptedSecret,
      sendAsset: "XLM",
      destAsset: "USDC",
      path: [],
      feeXlm: dec(FEE),
      mode: "strict_send",
      sendAmount: dec("10"),
      destMin: dec("9.3514012"),
    });
    expect(out).toMatchObject({ txHash: HASH, from: "XLM", to: "USDC" });
    expect(out.received.toFixed(7)).toBe("9.4458598");
    expect(await balancesOf(wallet.id)).toEqual({
      xlm: "89.9999900",
      xlmHeld: "0.0000000",
      usdc: "11.4458598",
      usdcHeld: "0.0000000",
    });
    expect(await ledger(wallet.id)).toEqual([
      {
        type: "SWAP",
        asset: "XLM",
        amount: "-10.0000000",
        balanceAfter: "90.0000000",
        hash: HASH,
        memo: "swap to USDC",
      },
      {
        type: "SWAP",
        asset: "USDC",
        amount: "9.4458598",
        balanceAfter: "11.4458598",
        hash: null,
        memo: `swap ${HASH}`,
      },
      {
        type: "SWAP",
        asset: "XLM",
        amount: `-${FEE}`,
        balanceAfter: "89.9999900",
        hash: null,
        memo: `swap ${HASH} network fee`,
      },
    ]);
  });

  it("swaps USDC for XLM with a strict receive and frees the USDC it did not need", async () => {
    const { user, wallet } = await makePayer({
      cachedXlm: "5.0000000",
      assets: { USDC: { cached: "2.0000000" } },
    });
    swap.mockResolvedValue({
      txHash: HASH,
      ok: true,
      sent: dec("0.9900000"),
      received: dec("6.9056371"),
      feeXlm: dec(FEE),
      failure: null,
    });

    await executeSwap({
      userId: user.id,
      from: "USDC",
      amount: dec("1"),
      minReceived: dec("6.9056371"),
    });

    expect(findConversionRoute).toHaveBeenCalledWith("USDC", "XLM", dec("6.9056371"));
    expect(swap).toHaveBeenCalledWith(
      expect.objectContaining({
        sendAsset: "USDC",
        destAsset: "XLM",
        mode: "strict_receive",
        sendMax: dec("1"),
        destAmount: dec("6.9056371"),
      }),
    );
    expect(await balancesOf(wallet.id)).toEqual({
      xlm: "11.9056271",
      xlmHeld: "0.0000000",
      usdc: "1.0100000",
      usdcHeld: "0.0000000",
    });
  });

  it("leaves another payment's hold in place", async () => {
    const { user, wallet } = await makePayer({
      cachedXlm: "100.0000000",
      reservedXlm: "5.0000000",
    });
    swap.mockResolvedValue({
      txHash: HASH,
      ok: true,
      sent: dec("10"),
      received: dec("9.4458598"),
      feeXlm: dec(FEE),
      failure: null,
    });
    await executeSwap({
      userId: user.id,
      from: "XLM",
      amount: dec("10"),
      minReceived: dec("9.3514012"),
    });
    expect((await balancesOf(wallet.id)).xlmHeld).toBe("5.0000000");
  });

  it("holds the amount and the fee while the transaction is out", async () => {
    const { user, wallet } = await makePayer({ cachedXlm: "100.0000000" });
    let during: Awaited<ReturnType<typeof balancesOf>> | null = null;
    swap.mockImplementation(async () => {
      during = await balancesOf(wallet.id);
      throw new Error("Horizon is down");
    });
    await refusal(
      executeSwap({ userId: user.id, from: "XLM", amount: dec("10"), minReceived: dec("9") }),
    );
    expect(during).toMatchObject({ xlm: "100.0000000", xlmHeld: "10.0000100" });
  });

  it("asks for a new quote when a strict send would now deliver less than the minimum", async () => {
    const { user, wallet } = await makePayer({ cachedXlm: "100.0000000" });
    findStrictSendPaths.mockResolvedValue([{ destAmount: dec("9.2"), path: [] }]);
    expect(
      await refusal(
        executeSwap({
          userId: user.id,
          from: "XLM",
          amount: dec("10"),
          minReceived: dec("9.3514012"),
        }),
      ),
    ).toEqual({ status: 409, reason: "price_changed" });
    expect(swap).not.toHaveBeenCalled();
    expect((await balancesOf(wallet.id)).xlmHeld).toBe("0.0000000");
  });

  it("asks for a new quote when a strict receive would now cost more than the payer entered", async () => {
    const { user } = await makePayer({ assets: { USDC: { cached: "2.0000000" } } });
    findConversionRoute.mockResolvedValue({ sourceAmount: dec("1.0000001"), path: [] });
    expect(
      await refusal(
        executeSwap({
          userId: user.id,
          from: "USDC",
          amount: dec("1"),
          minReceived: dec("6.9056371"),
        }),
      ),
    ).toEqual({ status: 409, reason: "price_changed" });
    expect(swap).not.toHaveBeenCalled();
  });

  it("sends a payer without the trustline to turn on USDC", async () => {
    const { user } = await makePayer({ cachedXlm: "100.0000000" });
    canReceive.mockResolvedValue(false);
    expect(
      await refusal(
        executeSwap({ userId: user.id, from: "XLM", amount: dec("10"), minReceived: dec("9") }),
      ),
    ).toEqual({ status: 409, reason: "payer_no_trustline" });
    expect(swap).not.toHaveBeenCalled();
  });

  it("refuses XLM the network keeps locked as the account's minimum balance", async () => {
    const { user, wallet } = await makePayer({ cachedXlm: "10.0000000" });
    const err = await executeSwap({
      userId: user.id,
      from: "XLM",
      amount: dec("9"),
      minReceived: dec("8"),
    }).catch((e: AppError) => e);
    // 10 held, 1.5 locked by the network, 0.00001 for the fee.
    expect(err).toMatchObject({
      status: 409,
      details: { reason: "insufficient_balance", max: "8.4999900" },
    });
    expect(swap).not.toHaveBeenCalled();
    expect((await balancesOf(wallet.id)).xlmHeld).toBe("0.0000000");
  });

  it("refuses more USDC than the wallet can spend, and a wallet with no XLM for the fee", async () => {
    const { user } = await makePayer({
      cachedXlm: "1.5000000",
      assets: { USDC: { cached: "2.0000000" } },
    });
    const usdc = (amount: string) =>
      refusal(
        executeSwap({ userId: user.id, from: "USDC", amount: dec(amount), minReceived: dec("1") }),
      );
    expect(await usdc("2.5")).toEqual({ status: 409, reason: "insufficient_balance" });
    // All 1.5 XLM is the locked minimum, so nothing is left to pay the fee with.
    expect(await usdc("1")).toEqual({ status: 409, reason: "insufficient_fee" });
    expect(swap).not.toHaveBeenCalled();
  });

  it("debits only the fee when the network took the swap and the conversion failed", async () => {
    const { user, wallet } = await makePayer({ cachedXlm: "100.0000000" });
    swap.mockResolvedValue({
      txHash: HASH,
      ok: false,
      sent: dec(0),
      received: dec(0),
      feeXlm: dec(FEE),
      failure: "op_under_dest_min",
    });
    const err = await executeSwap({
      userId: user.id,
      from: "XLM",
      amount: dec("10"),
      minReceived: dec("9.3514012"),
    }).catch((e: AppError) => e);
    expect(err).toMatchObject({
      status: 409,
      details: { reason: "failed", code: "op_under_dest_min", txHash: HASH },
    });
    expect((err as AppError).message).toMatch(/price moved/);
    expect(await balancesOf(wallet.id)).toMatchObject({ xlm: "99.9999900", xlmHeld: "0.0000000" });
    expect(await ledger(wallet.id)).toEqual([
      {
        type: "SWAP",
        asset: "XLM",
        amount: `-${FEE}`,
        balanceAfter: "99.9999900",
        hash: HASH,
        memo: "failed swap network fee",
      },
    ]);
    expect(await getRecentSwaps(user.id)).toEqual([]);
  });

  it("frees the holds and records nothing when the transaction never reached a ledger", async () => {
    const { user, wallet } = await makePayer({ cachedXlm: "100.0000000" });
    swap.mockRejectedValue(new Error("Stellar rejected the transaction (tx_too_late)"));
    expect(
      await refusal(
        executeSwap({ userId: user.id, from: "XLM", amount: dec("10"), minReceived: dec("9") }),
      ),
    ).toEqual({ status: 409, reason: "failed" });
    expect(await balancesOf(wallet.id)).toMatchObject({ xlm: "100.0000000", xlmHeld: "0.0000000" });
    expect(await ledger(wallet.id)).toEqual([]);
  });

  it("keeps the holds when it cannot be told whether the swap went through", async () => {
    const { user, wallet } = await makePayer({ cachedXlm: "100.0000000" });
    swap.mockRejectedValue(new SwapOutcomeUnknownError(HASH, new Error("timeout")));
    expect(
      await refusal(
        executeSwap({ userId: user.id, from: "XLM", amount: dec("10"), minReceived: dec("9") }),
      ),
    ).toEqual({ status: 409, reason: "unconfirmed" });
    expect(await balancesOf(wallet.id)).toMatchObject({
      xlm: "100.0000000",
      xlmHeld: "10.0000100",
    });
    // What is on hold is written down, for the reconcile job to settle.
    const [row] = await db.unconfirmedSwap.findMany({ where: { walletId: wallet.id } });
    expect(row).toMatchObject({
      txHash: HASH,
      fromAsset: "XLM",
      toAsset: "USDC",
      resolvedAt: null,
      outcome: null,
    });
    expect(row!.heldAmount.toFixed(7)).toBe("10.0000000");
    expect(row!.heldFeeXlm.toFixed(7)).toBe(FEE);
  });
});

describe("resolveUnconfirmedSwaps", () => {
  /** A payer whose 10 XLM swap could not be confirmed, with its holds in place. */
  async function unconfirmedSwap() {
    const made = await makePayer({
      cachedXlm: "100.0000000",
      assets: { USDC: { cached: "2.0000000" } },
    });
    swap.mockRejectedValue(new SwapOutcomeUnknownError(HASH, new Error("timeout")));
    await refusal(
      executeSwap({ userId: made.user.id, from: "XLM", amount: dec("10"), minReceived: dec("9") }),
    );
    return made;
  }

  const row = () => db.unconfirmedSwap.findUniqueOrThrow({ where: { txHash: HASH } });

  it("records a swap a ledger took, the way it would have been recorded when sent", async () => {
    const { user, wallet } = await unconfirmedSwap();
    swapOutcome.mockResolvedValue({
      state: "landed",
      result: {
        txHash: HASH,
        ok: true,
        sent: dec("10"),
        received: dec("9.4458598"),
        feeXlm: dec(FEE),
        failure: null,
      },
    });

    expect(await resolveUnconfirmedSwaps()).toEqual({ checked: 1, resolved: 1 });

    const saved = await row();
    expect(swapOutcome).toHaveBeenCalledWith(HASH, saved.createdAt);
    expect(saved.outcome).toBe("swapped");
    expect(saved.resolvedAt).toBeInstanceOf(Date);
    expect(await balancesOf(wallet.id)).toEqual({
      xlm: "89.9999900",
      xlmHeld: "0.0000000",
      usdc: "11.4458598",
      usdcHeld: "0.0000000",
    });
    expect((await ledger(wallet.id)).map((e) => [e.asset, e.amount, e.hash, e.memo])).toEqual([
      ["XLM", "-10.0000000", HASH, "swap to USDC"],
      ["USDC", "9.4458598", null, `swap ${HASH}`],
      ["XLM", `-${FEE}`, null, `swap ${HASH} network fee`],
    ]);
    expect(await getRecentSwaps(user.id)).toHaveLength(1);
    const logged = await db.auditLog.findFirst({ where: { action: "swap.unconfirmed.resolved" } });
    expect(logged).toMatchObject({
      target: wallet.id,
      metadata: { txHash: HASH, outcome: "swapped" },
    });
  });

  it("debits only the fee for a swap a ledger took and failed", async () => {
    const { wallet } = await unconfirmedSwap();
    swapOutcome.mockResolvedValue({
      state: "landed",
      result: {
        txHash: HASH,
        ok: false,
        sent: dec(0),
        received: dec(0),
        feeXlm: dec(FEE),
        failure: null,
      },
    });

    expect(await resolveUnconfirmedSwaps()).toEqual({ checked: 1, resolved: 1 });

    expect((await row()).outcome).toBe("failed");
    expect(await balancesOf(wallet.id)).toMatchObject({
      xlm: "99.9999900",
      xlmHeld: "0.0000000",
      usdc: "2.0000000",
    });
    expect((await ledger(wallet.id)).map((e) => [e.amount, e.hash, e.memo])).toEqual([
      [`-${FEE}`, HASH, "failed swap network fee"],
    ]);
  });

  it("frees the holds of a swap no ledger can take any more", async () => {
    const { wallet } = await unconfirmedSwap();
    swapOutcome.mockResolvedValue({ state: "expired" });

    expect(await resolveUnconfirmedSwaps()).toEqual({ checked: 1, resolved: 1 });

    expect((await row()).outcome).toBe("expired");
    expect(await balancesOf(wallet.id)).toMatchObject({ xlm: "100.0000000", xlmHeld: "0.0000000" });
    expect(await ledger(wallet.id)).toEqual([]);
  });

  it("leaves the holds while a ledger could still take the swap", async () => {
    const { wallet } = await unconfirmedSwap();
    swapOutcome.mockResolvedValue({ state: "pending" });

    expect(await resolveUnconfirmedSwaps()).toEqual({ checked: 1, resolved: 0 });

    expect((await row()).resolvedAt).toBeNull();
    expect(await balancesOf(wallet.id)).toMatchObject({
      xlm: "100.0000000",
      xlmHeld: "10.0000100",
    });
  });

  it("leaves the holds when Horizon still cannot be read, and tries again next time", async () => {
    const { wallet } = await unconfirmedSwap();
    swapOutcome.mockRejectedValueOnce(new Error("Horizon is down"));

    expect(await resolveUnconfirmedSwaps()).toEqual({ checked: 1, resolved: 0 });
    expect((await row()).resolvedAt).toBeNull();
    expect(await balancesOf(wallet.id)).toMatchObject({ xlmHeld: "10.0000100" });

    swapOutcome.mockResolvedValue({ state: "expired" });
    expect(await resolveUnconfirmedSwaps()).toEqual({ checked: 1, resolved: 1 });
    expect(await balancesOf(wallet.id)).toMatchObject({ xlm: "100.0000000", xlmHeld: "0.0000000" });
  });

  it("settles a swap once: a second run finds nothing left to do", async () => {
    const { wallet } = await unconfirmedSwap();
    swapOutcome.mockResolvedValue({ state: "expired" });

    await resolveUnconfirmedSwaps();
    expect(await resolveUnconfirmedSwaps()).toEqual({ checked: 0, resolved: 0 });

    expect(swapOutcome).toHaveBeenCalledTimes(1);
    expect(await balancesOf(wallet.id)).toMatchObject({ xlm: "100.0000000", xlmHeld: "0.0000000" });
  });
});

describe("getRecentSwaps", () => {
  it("lists each swap once, with both sides and the hash to look it up by", async () => {
    const { user } = await makePayer({ cachedXlm: "100.0000000" });
    swap.mockResolvedValue({
      txHash: HASH,
      ok: true,
      sent: dec("10"),
      received: dec("9.4458598"),
      feeXlm: dec(FEE),
      failure: null,
    });
    await executeSwap({
      userId: user.id,
      from: "XLM",
      amount: dec("10"),
      minReceived: dec("9.3514012"),
    });

    const swaps = await getRecentSwaps(user.id);
    expect(swaps).toHaveLength(1);
    expect(swaps[0]).toMatchObject({ txHash: HASH, from: "XLM", to: "USDC" });
    expect(swaps[0]!.sent.toFixed(7)).toBe("10.0000000");
    expect(swaps[0]!.received?.toFixed(7)).toBe("9.4458598");
  });
});

describe("getPayerSwaps", () => {
  it("pages through the swaps newest first, ready for the history list", async () => {
    const { user } = await makePayer({ cachedXlm: "100.0000000" });
    for (const [char, sent] of [
      ["a", "10"],
      ["b", "11"],
      ["c", "12"],
    ] as const) {
      swap.mockResolvedValue({
        txHash: char.repeat(64),
        ok: true,
        sent: dec(sent),
        received: dec("9.4458598"),
        feeXlm: dec(FEE),
        failure: null,
      });
      await executeSwap({
        userId: user.id,
        from: "XLM",
        amount: dec(sent),
        minReceived: dec("9.3514012"),
      });
    }

    const first = await getPayerSwaps(user.id, { limit: 2 });
    expect(first.items.map((s) => s.sent)).toEqual(["12.0000000 XLM", "11.0000000 XLM"]);
    expect(first.items[0]).toMatchObject({
      received: "9.4458598 USDC",
      txUrl: `https://stellar.expert/explorer/testnet/tx/${"c".repeat(64)}`,
    });
    expect(first.nextCursor).toBe(first.items[1]!.id);

    const second = await getPayerSwaps(user.id, { cursor: first.nextCursor, limit: 2 });
    expect(second.items.map((s) => s.sent)).toEqual(["10.0000000 XLM"]);
    expect(second.nextCursor).toBeUndefined();
  });

  it("leaves out a swap that failed and another payer's swaps", async () => {
    const { user } = await makePayer({ cachedXlm: "100.0000000" });
    const { user: stranger } = await makePayer({ cachedXlm: "100.0000000" });
    swap.mockResolvedValue({
      txHash: HASH,
      ok: false,
      sent: dec("0"),
      received: dec("0"),
      feeXlm: dec(FEE),
      failure: "op_under_dest_min",
    });
    await refusal(
      executeSwap({ userId: user.id, from: "XLM", amount: dec("10"), minReceived: dec("9") }),
    );
    swap.mockResolvedValue({
      txHash: "b".repeat(64),
      ok: true,
      sent: dec("10"),
      received: dec("9.4458598"),
      feeXlm: dec(FEE),
      failure: null,
    });
    await executeSwap({
      userId: stranger.id,
      from: "XLM",
      amount: dec("10"),
      minReceived: dec("9.3514012"),
    });

    expect(await getPayerSwaps(user.id, { limit: 20 })).toEqual({
      items: [],
      nextCursor: undefined,
    });
  });
});
