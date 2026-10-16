import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { buildEscrowTimeoutRefund, signWithFreighter } = vi.hoisted(() => ({
  buildEscrowTimeoutRefund: vi.fn(),
  signWithFreighter: vi.fn(),
}));
vi.mock("@/lib/client/escrow-timeout-refund", () => ({
  buildEscrowTimeoutRefund: (instructions: unknown) => buildEscrowTimeoutRefund(instructions),
}));
vi.mock("@/components/wallet/freighter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/wallet/freighter")>()),
  signWithFreighter: (xdr: string, expected: unknown) => signWithFreighter(xdr, expected),
}));

import { EscrowRefundPanel, type EscrowRefund } from "./EscrowRefundPanel";

const OWN = {
  address: "GOWNWALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  networkPassphrase: "Test SDF Network ; September 2015",
  networkName: "Testnet",
};
const INSTRUCTIONS = { paymentId: "p1", from: OWN.address, jobId: "ab".repeat(32) };
const OPEN: EscrowRefund = { available: true, secondsUntilAvailable: 0, waitingOnPayout: false };

type Reply = { status: number; body: unknown };

/** Answers each request from the first reply queued for its path. */
function mockApi(replies: Record<string, Reply[]>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const reply = replies[String(input)]?.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
}

const requested = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.map(([url]) => String(url));

function renderPanel(state: EscrowRefund) {
  const onRefunded = vi.fn();
  render(<EscrowRefundPanel paymentId="p1" asset="XLM" state={state} onRefunded={onRefunded} />);
  return onRefunded;
}

beforeEach(() => {
  buildEscrowTimeoutRefund.mockReset().mockResolvedValue({ xdr: "UNSIGNED-XDR", txHash: "h" });
  signWithFreighter.mockReset().mockResolvedValue({ ok: true, signedXdr: "SIGNED-XDR" });
});
afterEach(() => vi.restoreAllMocks());

describe("EscrowRefundPanel for a payment paid from the HeyPay wallet", () => {
  it("has HeyPay refund it, with nothing for the payer to sign", async () => {
    const fetchMock = mockApi({
      "/api/payments/p1/escrow-refund": [{ status: 200, body: { status: "REFUND_PENDING" } }],
    });
    const onRefunded = renderPanel(OPEN);
    expect(screen.queryByRole("button", { name: "Get my money back" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Refund from escrow" }));

    await waitFor(() => expect(onRefunded).toHaveBeenCalledWith({ status: "REFUND_PENDING" }));
    expect(requested(fetchMock)).toEqual(["/api/payments/p1/escrow-refund"]);
    expect(signWithFreighter).not.toHaveBeenCalled();
  });
});

describe("EscrowRefundPanel for a payment paid from the payer's own wallet", () => {
  it("offers nothing to press before the deadline or while the bank transfer runs", () => {
    renderPanel({ available: false, secondsUntilAvailable: 40, ownWallet: OWN });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/take your XLM back in about 40 seconds/)).toBeInTheDocument();
  });

  it("offers Get my money back once the deadline has passed, naming the wallet it returns to", () => {
    renderPanel({ ...OPEN, ownWallet: OWN });
    expect(screen.getByRole("button", { name: "Get my money back" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Refund from escrow" })).not.toBeInTheDocument();
    expect(
      screen.getByText(/returns to the wallet you paid from \(GOWN…XXXX\)/),
    ).toBeInTheDocument();
  });

  it("has the payer sign refund_after_timeout in Freighter and sends what they signed", async () => {
    const fetchMock = mockApi({
      "/api/payments/p1/escrow-refund/prepare": [{ status: 200, body: INSTRUCTIONS }],
      "/api/payments/p1/escrow-refund/signed": [
        { status: 200, body: { status: "REFUND_PENDING", refundTxHash: "r1" } },
      ],
    });
    const onRefunded = renderPanel({ ...OPEN, ownWallet: OWN });

    await userEvent.click(screen.getByRole("button", { name: "Get my money back" }));

    await waitFor(() =>
      expect(onRefunded).toHaveBeenCalledWith({ status: "REFUND_PENDING", refundTxHash: "r1" }),
    );
    // Never the custodial refund: HeyPay holds no key to that account.
    expect(requested(fetchMock)).toEqual([
      "/api/payments/p1/escrow-refund/prepare",
      "/api/payments/p1/escrow-refund/signed",
    ]);
    expect(buildEscrowTimeoutRefund).toHaveBeenCalledWith(INSTRUCTIONS);
    expect(signWithFreighter).toHaveBeenCalledWith("UNSIGNED-XDR", OWN);
    const sent = fetchMock.mock.calls.find(
      ([url]) => url === "/api/payments/p1/escrow-refund/signed",
    )![1];
    expect(JSON.parse(String(sent?.body))).toEqual({ xdr: "SIGNED-XDR" });
  });

  it("sends nothing when the payer cancels in Freighter, and lets them try again", async () => {
    signWithFreighter.mockResolvedValue({
      ok: false,
      reason: "cancelled",
      message: "You cancelled — nothing was sent.",
    });
    const fetchMock = mockApi({
      "/api/payments/p1/escrow-refund/prepare": [{ status: 200, body: INSTRUCTIONS }],
    });
    const onRefunded = renderPanel({ ...OPEN, ownWallet: OWN });

    await userEvent.click(screen.getByRole("button", { name: "Get my money back" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You cancelled — nothing was sent.");
    expect(requested(fetchMock)).toEqual(["/api/payments/p1/escrow-refund/prepare"]);
    expect(onRefunded).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Get my money back" })).toBeEnabled();
  });

  it("shows why the server would not prepare or take the refund", async () => {
    mockApi({
      "/api/payments/p1/escrow-refund/prepare": [
        {
          status: 409,
          body: { error: { message: "The escrow refund opens in about 15 seconds." } },
        },
      ],
    });
    const onRefunded = renderPanel({ ...OPEN, ownWallet: OWN });

    await userEvent.click(screen.getByRole("button", { name: "Get my money back" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/opens in about 15 seconds/);
    expect(buildEscrowTimeoutRefund).not.toHaveBeenCalled();
    expect(signWithFreighter).not.toHaveBeenCalled();
    expect(onRefunded).not.toHaveBeenCalled();
  });
});
