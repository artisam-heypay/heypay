import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { WalletsPanel, type OwnWalletView } from "./WalletsPanel";
import type { HoldingsSnapshot } from "./HoldingsLive";

const OWN_ADDRESS = "GDY2RNPWRZCEROBS2YJIHG7QDXVJ7VNF7XTFL2R4GJO4OAWI3LQ7UBH6";

const OWN: OwnWalletView = {
  address: OWN_ADDRESS,
  holdings: {
    totalPhp: "114247.72",
    hasUnpricedBalance: false,
    tokens: [
      { asset: "XLM", balance: "9925.9534020", valuePhp: "114247.72", canReceive: true },
      { asset: "USDC", balance: "0.0000000", valuePhp: "0.00", canReceive: false },
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

  it("shows both wallets side by side, each with its own total, never added together", () => {
    expect(screen.getByTestId("wallet-own-total")).toHaveTextContent("≈ ₱114,247.72");
    expect(screen.getByTestId("wallet-heypay-total")).toHaveTextContent("≈ ₱21,584.90");
    expect(screen.queryByText(/135,832\.62/)).not.toBeInTheDocument();
  });

  it("shows each asset on its own row, with its amount and what it is worth in pesos", () => {
    expect(screen.getByTestId("wallet-own-XLM")).toHaveTextContent("XLM9,925.95≈ ₱114,247.72");
    expect(screen.getByTestId("wallet-own-USDC")).toHaveTextContent("USDC0.00≈ ₱0.00");
    expect(screen.getByTestId("wallet-heypay-XLM")).toHaveTextContent("XLM948.87≈ ₱10,915.00");
    expect(screen.getByTestId("wallet-heypay-USDC")).toHaveTextContent("USDC169.53≈ ₱10,669.90");
  });

  it("never rounds a small balance down to zero", () => {
    expect(
      within(screen.getByTestId("wallet-heypay-XLM")).getByTitle("948.8742173 XLM"),
    ).toBeInTheDocument();
  });

  it("marks the own wallet as in use, in words as well as colour", () => {
    expect(within(ownCard()).getByText("In use")).toBeInTheDocument();
    expect(within(heypayCard()).queryByText("In use")).not.toBeInTheDocument();
    expect(ownCard()).toHaveAccessibleName("Freighter, in use for payments");
    expect(heypayCard()).toHaveAccessibleName("HeyPay wallet");
  });

  it("names who holds each wallet: the payer's own address, or HeyPay", () => {
    expect(within(ownCard()).getByText("GDY2…UBH6")).toBeInTheDocument();
    expect(within(heypayCard()).getByText("Held by HeyPay")).toBeInTheDocument();
  });

  it("offers the HeyPay wallet for payments, and not its prefund or swap", () => {
    expect(
      within(heypayCard()).getByRole("button", { name: "Use this wallet" }),
    ).toBeInTheDocument();
    expect(within(heypayCard()).queryByRole("link", { name: /Prefund/ })).not.toBeInTheDocument();
    expect(
      within(ownCard()).queryByRole("button", { name: "Use this wallet" }),
    ).not.toBeInTheDocument();
  });
});

describe("WalletsPanel paying from the HeyPay wallet", () => {
  it("marks the HeyPay wallet, offers its prefund and swap, and offers the own wallet", () => {
    render(<WalletsPanel paysWithOwn={false} heypay={HEYPAY} own={OWN} canSwap />);

    expect(within(heypayCard()).getByText("In use")).toBeInTheDocument();
    expect(within(heypayCard()).getByRole("link", { name: /Prefund/ })).toHaveAttribute(
      "href",
      "/payer/prefund",
    );
    expect(within(heypayCard()).getByRole("link", { name: /Swap/ })).toHaveAttribute(
      "href",
      "/payer/swap",
    );
    expect(within(ownCard()).getByRole("button", { name: "Use this wallet" })).toBeInTheDocument();
  });

  it("offers to connect a wallet of their own when none is connected", () => {
    render(<WalletsPanel paysWithOwn={false} heypay={HEYPAY} own={null} canSwap={false} />);

    const connect = screen.getByTestId("wallet-own-connect");
    expect(within(connect).getByRole("link", { name: /Connect/ })).toHaveAttribute(
      "href",
      "/payer/settings",
    );
    expect(within(heypayCard()).queryByRole("link", { name: /Swap/ })).not.toBeInTheDocument();
  });
});

describe("WalletsPanel when Stellar cannot be read", () => {
  it("says so instead of showing an empty own wallet", () => {
    render(<WalletsPanel paysWithOwn heypay={HEYPAY} own={{ ...OWN, holdings: null }} canSwap />);
    expect(within(ownCard()).getByRole("status")).toHaveTextContent(
      "Can't read Stellar right now.",
    );
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

    expect(screen.getByTestId("wallet-own-total")).toHaveTextContent("≈ ₱114,247.72");
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

    await waitFor(() =>
      expect(screen.getByTestId("wallet-own-total")).toHaveTextContent("≈ ₱100,000.00"),
    );
  });
});

describe("WalletsPanel small amounts", () => {
  it("shows up to seven decimals below 1, so a small balance is not 0.00", () => {
    render(
      <WalletsPanel
        paysWithOwn={false}
        heypay={{
          totalPhp: "0.29",
          hasUnpricedBalance: false,
          tokens: [{ asset: "USDC", balance: "0.0047000", valuePhp: "0.29" }],
        }}
        own={null}
        canSwap
      />,
    );
    expect(screen.getByTestId("wallet-heypay-USDC")).toHaveTextContent("USDC0.0047≈ ₱0.29");
  });
});
