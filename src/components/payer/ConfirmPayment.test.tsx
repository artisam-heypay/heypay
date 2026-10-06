import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

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
        refused(400, "HeyPay cannot receive USDC payments right now.", {
          reason: "destination_no_trustline",
          asset: "USDC",
        }),
      ],
    });
    renderConfirm("XLM");

    await user.click(screen.getByRole("radio", { name: /USDC/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "HeyPay cannot receive USDC payments right now.",
    );
    expect(screen.queryByRole("link", { name: /^Add / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Turn on|Pay with/ })).not.toBeInTheDocument();
  });
});
