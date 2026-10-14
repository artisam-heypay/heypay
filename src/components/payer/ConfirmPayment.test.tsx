import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { replace, refresh } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

import { ConfirmPayment } from "./ConfirmPayment";

const OPTIONS = [
  { asset: "XLM", available: "100.0000000", canReceive: true },
  { asset: "USDC", available: "50.0000000", canReceive: true },
];

function renderConfirm(asset: "XLM" | "USDC" = "XLM") {
  return render(
    <ConfirmPayment
      paymentId="p1"
      merchantId="m1"
      asset={asset}
      assetOptions={OPTIONS}
      amountPhp="100.00"
      quotedRate={asset === "XLM" ? "12.00000000" : "62.34000000"}
      amountAsset={asset === "XLM" ? "8.3333334" : "1.6041066"}
      networkFeeXlm="0.0000100"
      quoteExpiresAt={null}
      merchantName="Sari Store"
      walletPublicKey="GPAYER"
      availableAsset={asset === "XLM" ? "100.0000000" : "50.0000000"}
      approxPhp="1200.00"
    />,
  );
}

type Reply = { status: number; body: unknown };
const refused = (status: number, message: string, details: Record<string, string>): Reply => ({
  status,
  body: { error: { code: status === 409 ? "CONFLICT" : "BAD_REQUEST", message, details } },
});

/** Answers each request from the first reply queued for its path. */
function mockApi(replies: Record<string, Reply[]>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const reply = replies[String(input)]?.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
}

/** The asset each quote request asked for, in order. */
function quotedAssets(fetchMock: ReturnType<typeof mockApi>): string[] {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/payments/quote")
    .map(([, init]) => (JSON.parse(String(init?.body)) as { asset: string }).asset);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("ConfirmPayment — refused payments", () => {
  it("missing trustline: offers to turn on USDC, then quotes in USDC", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      "/api/payments/quote": [
        refused(400, "Turn on USDC first.", { reason: "payer_no_trustline", asset: "USDC" }),
        { status: 200, body: { paymentId: "p2" } },
      ],
      "/api/wallet/trustline": [{ status: 200, body: { asset: "USDC", txUrl: null } }],
    });
    renderConfirm("XLM");

    await user.click(screen.getByRole("radio", { name: /USDC/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Turn on USDC first.");
    expect(replace).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Turn on USDC/ }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/payer/pay/p2/confirm"));
    expect(quotedAssets(fetchMock)).toEqual(["USDC", "USDC"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asset mismatch: says the shop is paid in a different currency", async () => {
    const user = userEvent.setup();
    mockApi({
      "/api/payments/quote": [
        refused(400, "This shop is paid in a different currency. Pay with XLM instead.", {
          reason: "asset_mismatch",
          asset: "USDC",
          payWith: "XLM",
        }),
      ],
    });
    renderConfirm("XLM");

    await user.click(screen.getByRole("radio", { name: /USDC/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This shop is paid in a different currency. Pay with XLM instead.",
    );
    // The payment on screen is the XLM one already, so it only has to be confirmed.
    expect(screen.queryByRole("button", { name: "Pay with XLM" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm/ })).toBeEnabled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("insufficient balance: links to add USDC and offers to pay with XLM", async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      "/api/payments/p1/confirm": [
        refused(409, "Not enough USDC — add more or pay with XLM.", {
          reason: "insufficient_balance",
          asset: "USDC",
          payWith: "XLM",
        }),
      ],
      "/api/payments/quote": [{ status: 200, body: { paymentId: "p3" } }],
    });
    renderConfirm("USDC");

    await user.click(screen.getByRole("button", { name: /Confirm/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Not enough USDC — add more or pay with XLM.",
    );
    // Nothing was held, so the screen is back, not a failed payment.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirm/ })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Add USDC" })).toHaveAttribute(
      "href",
      "/payer/prefund",
    );

    await user.click(screen.getByRole("button", { name: "Pay with XLM" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/payer/pay/p3/confirm"));
    expect(quotedAssets(fetchMock)).toEqual(["XLM"]);
  });

  it("short network fee: links to add XLM, with no other asset to offer", async () => {
    const user = userEvent.setup();
    mockApi({
      "/api/payments/p1/confirm": [
        refused(409, "Not enough XLM for the network fee — add about 0.21 XLM.", {
          reason: "insufficient_fee",
          asset: "USDC",
          feeXlm: "0.21",
        }),
      ],
    });
    renderConfirm("USDC");

    await user.click(screen.getByRole("button", { name: /Confirm/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Not enough XLM for the network fee — add about 0.21 XLM.",
    );
    expect(screen.getByRole("link", { name: "Add XLM" })).toHaveAttribute("href", "/payer/prefund");
    expect(screen.queryByRole("button", { name: /Pay with/ })).not.toBeInTheDocument();
  });

  it("shows any other failed quote as its message alone", async () => {
    const user = userEvent.setup();
    mockApi({
      "/api/payments/quote": [
        refused(400, "HeyPay cannot hold USDC payments in escrow right now.", {
          reason: "no_escrow",
          asset: "USDC",
        }),
      ],
    });
    renderConfirm("XLM");

    await user.click(screen.getByRole("radio", { name: /USDC/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "HeyPay cannot hold USDC payments in escrow right now.",
    );
    expect(screen.queryByRole("link", { name: /^Add / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Turn on|Pay with/ })).not.toBeInTheDocument();
  });
});

describe("ConfirmPayment when the payer turned on their own wallet meanwhile", () => {
  it("pays nothing from the HeyPay wallet and draws the page again for their own", async () => {
    mockApi({
      "/api/payments/p1/confirm": [
        refused(409, "You pay from your own wallet. Sign this payment in Freighter.", {
          reason: "own_wallet_pays",
        }),
      ],
    });
    renderConfirm("XLM");

    await userEvent.click(screen.getByRole("button", { name: /Confirm/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Sign this payment in Freighter/);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Not left disabled: once redrawn, the button signs with their own wallet.
    expect(screen.getByRole("button", { name: /Confirm/ })).toBeEnabled();
  });
});

// ---- paying from the payer's own wallet ----
const { buildEscrowDeposit, signWithFreighter } = vi.hoisted(() => ({
  buildEscrowDeposit: vi.fn(),
  signWithFreighter: vi.fn(),
}));
vi.mock("@/lib/client/escrow-deposit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/client/escrow-deposit")>()),
  buildEscrowDeposit: (instructions: unknown) => buildEscrowDeposit(instructions),
}));
vi.mock("@/components/wallet/freighter", () => ({
  signWithFreighter: (xdr: string, expected: unknown) => signWithFreighter(xdr, expected),
}));

describe("ConfirmPayment for a payer who pays from their own wallet", () => {
  const OWN = {
    address: "GOWNWALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    networkPassphrase: "Test SDF Network ; September 2015",
    networkName: "Testnet",
  };
  const instructions = (validForMs = 90_000) => ({
    paymentId: "p1",
    from: OWN.address,
    amount: "83333334",
    validUntil: new Date(Date.now() + validForMs).toISOString(),
  });
  const INSTRUCTIONS = instructions();

  function renderOwn() {
    return render(
      <ConfirmPayment
        paymentId="p1"
        merchantId="m1"
        asset="XLM"
        assetOptions={OPTIONS}
        amountPhp="100.00"
        quotedRate="12.00000000"
        amountAsset="8.3333334"
        networkFeeXlm="0.0000100"
        quoteExpiresAt={null}
        merchantName="Sari Store"
        walletPublicKey={OWN.address}
        availableAsset="100.0000000"
        approxPhp="1200.00"
        ownWallet={OWN}
      />,
    );
  }

  /** The paths requested, in order. */
  const requested = (fetchMock: ReturnType<typeof mockApi>) =>
    fetchMock.mock.calls.map(([url]) => String(url));

  beforeEach(() => {
    buildEscrowDeposit.mockReset().mockResolvedValue({ xdr: "UNSIGNED-XDR", txHash: "h" });
    signWithFreighter.mockReset().mockResolvedValue({ ok: true, signedXdr: "SIGNED-XDR" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("has the payer sign in Freighter and sends what they signed, with no custodial confirm", async () => {
    const fetchMock = mockApi({
      "/api/payments/p1/prepare": [{ status: 200, body: INSTRUCTIONS }],
      "/api/payments/p1/signed": [{ status: 200, body: { status: "AUTHORIZED" } }],
    });
    renderOwn();
    expect(screen.queryByRole("button", { name: /^confirm/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /sign with freighter/i }));

    // The progress overlay takes over once the server has the signed transaction.
    expect(await screen.findByRole("dialog")).toHaveTextContent("Processing payment…");
    expect(requested(fetchMock)).toEqual(["/api/payments/p1/prepare", "/api/payments/p1/signed"]);
    // Built from what the server said the deposit must be, signed by the connected account.
    expect(buildEscrowDeposit).toHaveBeenCalledWith(INSTRUCTIONS);
    expect(signWithFreighter).toHaveBeenCalledWith("UNSIGNED-XDR", OWN);
    const sent = fetchMock.mock.calls.find(([url]) => url === "/api/payments/p1/signed")![1];
    expect(JSON.parse(String(sent?.body))).toEqual({ xdr: "SIGNED-XDR" });
  });

  it("says the payer cancelled and sends nothing when they reject in Freighter", async () => {
    signWithFreighter.mockResolvedValue({
      ok: false,
      reason: "cancelled",
      message: "You cancelled — nothing was sent.",
    });
    const fetchMock = mockApi({
      "/api/payments/p1/prepare": [{ status: 200, body: INSTRUCTIONS }],
    });
    renderOwn();

    await userEvent.click(screen.getByRole("button", { name: /sign with freighter/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You cancelled — nothing was sent.");
    expect(requested(fetchMock)).toEqual(["/api/payments/p1/prepare"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The payment is still a quote: the payer can try again.
    expect(screen.getByRole("button", { name: /sign with freighter/i })).toBeEnabled();
  });

  it.each([
    [
      "wrong_network",
      "Freighter is on another network, so nothing was sent. In Freighter, switch the network to Testnet, then try again.",
    ],
    [
      "wrong_account",
      "Freighter is on another account, so nothing was sent. In Freighter, switch to GOWN…XXXX, the wallet you connected, then try again.",
    ],
  ])("%s: says how to put it right in Freighter and sends nothing", async (reason, message) => {
    signWithFreighter.mockResolvedValue({ ok: false, reason, message });
    const fetchMock = mockApi({
      "/api/payments/p1/prepare": [{ status: 200, body: INSTRUCTIONS }],
    });
    renderOwn();

    await userEvent.click(screen.getByRole("button", { name: /sign with freighter/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(requested(fetchMock)).toEqual(["/api/payments/p1/prepare"]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign with freighter/i })).toBeEnabled();
  });

  it("prepares a fresh deposit and asks again when the server finds the signed one expired", async () => {
    buildEscrowDeposit
      .mockResolvedValueOnce({ xdr: "UNSIGNED-1", txHash: "h1" })
      .mockResolvedValueOnce({ xdr: "UNSIGNED-2", txHash: "h2" });
    signWithFreighter
      .mockResolvedValueOnce({ ok: true, signedXdr: "SIGNED-1" })
      .mockResolvedValueOnce({ ok: true, signedXdr: "SIGNED-2" });
    const fetchMock = mockApi({
      "/api/payments/p1/prepare": [
        { status: 200, body: INSTRUCTIONS },
        { status: 200, body: INSTRUCTIONS },
      ],
      "/api/payments/p1/signed": [
        refused(400, "The transaction you signed has expired. Nothing was sent. Try again.", {
          reason: "expired",
        }),
        { status: 200, body: { status: "AUTHORIZED" } },
      ],
    });
    renderOwn();

    await userEvent.click(screen.getByRole("button", { name: /sign with freighter/i }));

    expect(await screen.findByRole("dialog")).toHaveTextContent("Processing payment…");
    expect(requested(fetchMock).slice(0, 4)).toEqual([
      "/api/payments/p1/prepare",
      "/api/payments/p1/signed",
      "/api/payments/p1/prepare",
      "/api/payments/p1/signed",
    ]);
    // The second signature is over the second deposit, and that is the one sent.
    expect(signWithFreighter).toHaveBeenNthCalledWith(2, "UNSIGNED-2", OWN);
    const sent = fetchMock.mock.calls.filter(([url]) => url === "/api/payments/p1/signed");
    expect(JSON.parse(String(sent[1]![1]?.body))).toEqual({ xdr: "SIGNED-2" });
  });

  it("does not send a deposit approved after it stopped being valid, and stops after one more try", async () => {
    const fetchMock = mockApi({
      "/api/payments/p1/prepare": [
        { status: 200, body: instructions(-1000) },
        { status: 200, body: instructions(-1000) },
      ],
    });
    renderOwn();

    await userEvent.click(screen.getByRole("button", { name: /sign with freighter/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /expired before it was approved, so nothing was sent/,
    );
    expect(requested(fetchMock)).toEqual(["/api/payments/p1/prepare", "/api/payments/p1/prepare"]);
    expect(signWithFreighter).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign with freighter/i })).toBeEnabled();
  });

  it.each([
    [
      "switched back to the HeyPay wallet",
      refused(409, "This payment is paid from your HeyPay wallet.", {
        reason: "heypay_wallet_pays",
      }),
    ],
    ["own wallets were turned off", { status: 404, body: { error: { code: "NOT_FOUND" } } }],
  ])("falls back to the HeyPay wallet when the payer %s", async (_name, reply) => {
    const fetchMock = mockApi({ "/api/payments/p1/prepare": [reply] });
    renderOwn();

    await userEvent.click(screen.getByRole("button", { name: /sign with freighter/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /switched back to your HeyPay wallet, so nothing was sent from your own wallet/,
    );
    // Nothing was built, signed or sent; the page is drawn again for the wallet that pays.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(requested(fetchMock)).toEqual(["/api/payments/p1/prepare"]);
    expect(buildEscrowDeposit).not.toHaveBeenCalled();
    expect(signWithFreighter).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("falls back as well when the switch happens between signing and sending", async () => {
    mockApi({
      "/api/payments/p1/prepare": [{ status: 200, body: INSTRUCTIONS }],
      "/api/payments/p1/signed": [
        refused(409, "This payment is paid from your HeyPay wallet.", {
          reason: "heypay_wallet_pays",
        }),
      ],
    });
    renderOwn();

    await userEvent.click(screen.getByRole("button", { name: /sign with freighter/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/switched back to your HeyPay/);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows why the server turned the signed transaction down", async () => {
    mockApi({
      "/api/payments/p1/prepare": [{ status: 200, body: INSTRUCTIONS }],
      "/api/payments/p1/signed": [
        refused(400, "The transaction is not signed by your connected wallet (GOWN…XXXX).", {
          reason: "not_signed",
        }),
      ],
    });
    renderOwn();

    await userEvent.click(screen.getByRole("button", { name: /sign with freighter/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /not signed by your connected wallet/,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks nothing of Freighter when the server will not prepare the payment", async () => {
    mockApi({
      "/api/payments/p1/prepare": [refused(409, "quote expired; please re-quote", {})],
    });
    renderOwn();

    await userEvent.click(screen.getByRole("button", { name: /sign with freighter/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/quote expired/);
    expect(buildEscrowDeposit).not.toHaveBeenCalled();
    expect(signWithFreighter).not.toHaveBeenCalled();
  });
});
