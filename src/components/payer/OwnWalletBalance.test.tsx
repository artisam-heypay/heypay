import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { OwnWalletBalance } from "./OwnWalletBalance";
import type { HoldingsSnapshot } from "./HoldingsLive";

const OWN = "GDY2RNPWRZCEROBS2YJIHG7QDXVJ7VNF7XTFL2R4GJO4OAWI3LQ7UBH6";
const EXPLORER = `https://stellar.expert/explorer/testnet/account/${OWN}`;

const HOLDINGS: HoldingsSnapshot = {
  totalPhp: "119039.06",
  hasUnpricedBalance: false,
  tokens: [
    {
      asset: "XLM",
      balance: "9991.5278264",
      available: "9990.3278164",
      valuePhp: "119039.06",
      rate: "11.91000000",
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
};

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe("OwnWalletBalance", () => {
  it("shows the Freighter wallet as the one that pays, held by the payer", () => {
    render(<OwnWalletBalance address={OWN} explorerUrl={EXPLORER} initial={HOLDINGS} />);

    expect(screen.getByRole("heading", { name: "Your wallet · Freighter" })).toBeInTheDocument();
    expect(screen.getByText("Pays now")).toBeInTheDocument();
    expect(screen.getByText("You hold the key")).toBeInTheDocument();
    expect(
      screen.getByText("Read from Stellar. HeyPay does not hold this money."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View on Stellar/ })).toHaveAttribute("href", EXPLORER);
    expect(screen.getByRole("link", { name: /Scan to pay/ })).toHaveAttribute(
      "href",
      "/payer/scan",
    );
  });

  it("shows each balance, what a payment can spend now, and what the wallet cannot hold yet", () => {
    render(<OwnWalletBalance address={OWN} explorerUrl={EXPLORER} initial={HOLDINGS} />);

    expect(screen.getByTestId("own-holding-XLM")).toHaveTextContent("9991.5278264");
    expect(screen.getByText(/Spendable now/)).toHaveTextContent("9990.3278164");
    expect(screen.getByTestId("own-holding-USDC")).toHaveTextContent(
      "Add USDC in Freighter to pay with it.",
    );
  });

  it("says the wallet could not be read instead of showing zero", () => {
    render(<OwnWalletBalance address={OWN} explorerUrl={EXPLORER} initial={null} />);

    expect(screen.getByRole("status")).toHaveTextContent(/could not be read from Stellar/);
    expect(screen.queryByText(/₱0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Spendable now/)).not.toBeInTheDocument();
  });

  it("reads the wallet again when the payer comes back to the tab", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          readable: true,
          holdings: {
            ...HOLDINGS,
            tokens: [{ ...HOLDINGS.tokens[0]!, balance: "9977.2421121" }],
          },
        }),
      ),
    );
    render(<OwnWalletBalance address={OWN} explorerUrl={EXPLORER} initial={HOLDINGS} />);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(fetch).toHaveBeenCalledWith("/api/wallet/external", expect.anything());
    expect(await screen.findByText("9977.2421121 XLM")).toBeInTheDocument();
  });

  it("keeps the last balance when a later read fails", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ readable: false, holdings: null })),
    );
    render(<OwnWalletBalance address={OWN} explorerUrl={EXPLORER} initial={HOLDINGS} />);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(screen.getByTestId("own-holding-XLM")).toHaveTextContent("9991.5278264");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
