import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { TransactionDrawer } from "./TransactionDrawer";

const STELLAR_TX = "a".repeat(64);

/** What the payment API answers with for a payment in `status`. */
function mockPayment(status: string, stellarTxHash: string | null = null) {
  vi.mocked(fetch).mockResolvedValue({
    ok: true,
    json: async () => ({
      payment: {
        reference: "TXN-PLILAOVM",
        status,
        amountPhp: "100.00",
        quotedRate: "62.79000000",
        asset: "USDC",
        amountAsset: "1.5926103",
        networkFeeXlm: "0.0000100",
        merchantName: "HeyPay Test Shop",
        stellarTxHash,
        stellarTxUrl: stellarTxHash ? `https://stellar.expert/tx/${stellarTxHash}` : null,
        refundTxHash: null,
        refundTxUrl: null,
        createdAt: "2026-10-06T07:15:26.000Z",
      },
      events: [
        { fromStatus: "CREATED", toStatus: "QUOTED", createdAt: "2026-10-06T07:15:26.000Z" },
      ],
    }),
  } as Response);
}

async function openDrawer() {
  render(<TransactionDrawer paymentId="p1" onClose={() => {}} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

/** Lets the pending poll finish, then runs the next one. */
async function nextPoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TransactionDrawer", () => {
  it("follows a payment that moves on while the drawer is open", async () => {
    mockPayment("QUOTED");
    await openDrawer();
    expect(screen.getByText("Quoted")).toBeInTheDocument();

    mockPayment("SETTLED", STELLAR_TX);
    await nextPoll();

    expect(fetch).toHaveBeenCalledWith("/api/payments/p1", expect.anything());
    expect(screen.getByText("Settled")).toBeInTheDocument();
    expect(screen.queryByText("Quoted")).not.toBeInTheDocument();
  });

  it("stops asking once the payment is final", async () => {
    mockPayment("SETTLED", STELLAR_TX);
    await openDrawer();
    const asked = vi.mocked(fetch).mock.calls.length;

    await nextPoll();
    await nextPoll();

    expect(fetch).toHaveBeenCalledTimes(asked);
  });

  it("says the crypto was debited only once the payment is on Stellar", async () => {
    mockPayment("QUOTED");
    await openDrawer();
    expect(screen.getByText("USDC amount")).toBeInTheDocument();
    expect(screen.queryByText("USDC debited")).not.toBeInTheDocument();

    mockPayment("STELLAR_CONFIRMED", STELLAR_TX);
    await nextPoll();

    expect(screen.getByText("USDC debited")).toBeInTheDocument();
  });

  it("shows a refunded payment's crypto as refunded, and the rate in centavos", async () => {
    mockPayment("REFUNDED", STELLAR_TX);
    await openDrawer();

    expect(screen.getByText("USDC refunded")).toBeInTheDocument();
    expect(screen.queryByText("USDC debited")).not.toBeInTheDocument();
    expect(screen.getByText("1 USDC = ₱62.79")).toBeInTheDocument();
  });
});
