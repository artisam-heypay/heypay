import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { WalletsPanel, type OwnWalletView } from "./WalletsPanel";
import type { HoldingsSnapshot } from "./HoldingsLive";

const OWN_ADDRESS = "GDY2RNPWRZCEROBS2YJIHG7QDXVJ7VNF7XTFL2R4GJO4OAWI3LQ7UBH6";

const OWN: OwnWalletView = {
  address: OWN_ADDRESS,
  explorerUrl: `https://stellar.expert/explorer/testnet/account/${OWN_ADDRESS}`,
  holdings: {
    totalPhp: "114247.72",
    hasUnpricedBalance: false,
    tokens: [
      {
        asset: "XLM",
        balance: "9925.9534020",
        available: "9924.7533920",
        valuePhp: "114247.72",
        canReceive: true,
      },
      {
        asset: "USDC",
        balance: "0.0000000",
        available: "0.0000000",
        valuePhp: "0.00",
        canReceive: false,
      },
    ],
  },
};

const HEYPAY: HoldingsSnapshot = {
  totalPhp: "21584.90",
  hasUnpricedBalance: false,
  tokens: [
    { asset: "XLM", balance: "948.8742173", valuePhp: "10915.00" },
    { asset: "USDC", balance: "169.5287992", valuePhp: "10669.90" },
  ],
};

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

const ownCard = () => screen.getByTestId("wallet-own");
const heypayCard = () => screen.getByTestId("wallet-heypay");

describe("WalletsPanel paying from the payer's own wallet", () => {
  beforeEach(() => {
    render(<WalletsPanel paysWithOwn heypay={HEYPAY} own={OWN} canSwap />);
  });

  it("shows both wallets side by side, each with its own balance, never added together", () => {
    expect(within(ownCard()).getByText("₱114,247.72")).toBeInTheDocument();
    expect(within(heypayCard()).getByText("₱21,584.90")).toBeInTheDocument();
    expect(screen.queryByText("₱135,832.62")).not.toBeInTheDocument();
  });

  it("marks the own wallet as the one payments come from, in words as well as colour", () => {
    expect(within(ownCard()).getByText("Used for payments")).toBeInTheDocument();
    expect(within(heypayCard()).queryByText("Used for payments")).not.toBeInTheDocument();
    expect(ownCard()).toHaveAccessibleName("Freighter, used for payments");
    expect(heypayCard()).toHaveAccessibleName("HeyPay wallet");
  });

  it("says plainly who can move each wallet's money", () => {
    expect(within(ownCard()).getByText(/Only you can move this money/)).toBeInTheDocument();
    expect(within(heypayCard()).getByText("HeyPay keeps this money for you.")).toBeInTheDocument();
  });

  it("shows the own wallet's short address, what a payment can spend, and what it cannot hold", () => {
    expect(within(ownCard()).getByText("GDY2…UBH6")).toBeInTheDocument();
    expect(within(ownCard()).getByText(/Spendable now/)).toHaveTextContent("9924.7533920 XLM");
    expect(screen.getByTestId("wallet-own-USDC")).toHaveTextContent(
      "Add USDC in Freighter to pay with it.",
    );
    expect(within(ownCard()).getByRole("link", { name: /View on Stellar/ })).toHaveAttribute(
      "href",
      OWN.explorerUrl,
    );
  });

  it("offers the HeyPay wallet for payments, and not its prefund or swap", () => {
    expect(
      within(heypayCard()).getByRole("button", { name: "Use for payments" }),
    ).toBeInTheDocument();
    expect(within(heypayCard()).queryByRole("link", { name: /Prefund/ })).not.toBeInTheDocument();
    expect(
      within(ownCard()).queryByRole("button", { name: "Use for payments" }),
    ).not.toBeInTheDocument();
  });
});

describe("WalletsPanel paying from the HeyPay wallet", () => {
  it("marks the HeyPay wallet, offers its prefund and swap, and offers the own wallet for payments", () => {
    render(<WalletsPanel paysWithOwn={false} heypay={HEYPAY} own={OWN} canSwap />);

    expect(within(heypayCard()).getByText("Used for payments")).toBeInTheDocument();
    expect(within(heypayCard()).getByRole("link", { name: /Prefund/ })).toHaveAttribute(
      "href",
      "/payer/prefund",
    );
    expect(within(heypayCard()).getByRole("link", { name: /Swap/ })).toHaveAttribute(
      "href",
      "/payer/swap",
    );
    expect(within(ownCard()).getByRole("button", { name: "Use for payments" })).toBeInTheDocument();
    // Spendable is only worth reading for the wallet that pays.
    expect(within(ownCard()).queryByText(/Spendable now/)).not.toBeInTheDocument();
  });

  it("offers to connect a wallet of their own when none is connected", () => {
    render(<WalletsPanel paysWithOwn={false} heypay={HEYPAY} own={null} canSwap={false} />);

    const connect = screen.getByTestId("wallet-own-connect");
    expect(within(connect).getByRole("link", { name: /Connect Freighter/ })).toHaveAttribute(
      "href",
      "/payer/settings",
    );
    expect(within(heypayCard()).queryByRole("link", { name: /Swap/ })).not.toBeInTheDocument();
  });
});

describe("WalletsPanel when Stellar cannot be read", () => {
  it("says so instead of showing an empty own wallet", () => {
    render(<WalletsPanel paysWithOwn heypay={HEYPAY} own={{ ...OWN, holdings: null }} canSwap />);
    expect(within(ownCard()).getByRole("status")).toHaveTextContent(/could not be reached/);
    expect(within(ownCard()).queryByText(/₱/)).not.toBeInTheDocument();
  });

  it("keeps the balance already shown when a later read fails", async () => {
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url) === "/api/wallet/external"
        ? new Response(JSON.stringify({ readable: false, holdings: null }))
        : new Response(
            JSON.stringify({ totalPhp: "21584.90", hasUnpricedBalance: false, assets: [] }),
          ),
    );
    render(<WalletsPanel paysWithOwn heypay={HEYPAY} own={OWN} canSwap />);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(within(ownCard()).getByText("₱114,247.72")).toBeInTheDocument();
  });

  it("shows a fresh balance after a successful read", async () => {
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url) === "/api/wallet/external"
        ? new Response(
            JSON.stringify({
              readable: true,
              holdings: { ...OWN.holdings, totalPhp: "100000.00" },
            }),
          )
        : new Response(
            JSON.stringify({ totalPhp: "21584.90", hasUnpricedBalance: false, assets: [] }),
          ),
    );
    render(<WalletsPanel paysWithOwn heypay={HEYPAY} own={OWN} canSwap />);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(await within(ownCard()).findByText("₱100,000.00")).toBeInTheDocument();
  });
});

describe("WalletsPanel hints", () => {
  it("tells the payer to add an asset in Freighter only on the Freighter card", () => {
    render(
      <WalletsPanel
        paysWithOwn
        heypay={{
          ...HEYPAY,
          tokens: [{ asset: "USDC", balance: "0.0000000", valuePhp: "0.00", canReceive: false }],
        }}
        own={OWN}
        canSwap
      />,
    );
    expect(within(heypayCard()).queryByText(/Add USDC in Freighter/)).not.toBeInTheDocument();
    expect(
      within(ownCard()).getByText("Add USDC in Freighter to pay with it."),
    ).toBeInTheDocument();
  });
});
