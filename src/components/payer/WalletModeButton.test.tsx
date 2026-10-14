import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { WalletModeButton } from "./WalletModeButton";
import { HeyPayWalletAside } from "./HeyPayWalletAside";
import { FreighterStrip } from "./FreighterStrip";

const OWN = "GDY2RNPWRZCEROBS2YJIHG7QDXVJ7VNF7XTFL2R4GJO4OAWI3LQ7UBH6";

beforeEach(() => {
  refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("WalletModeButton", () => {
  it("switches the wallet that pays and draws the page again", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ walletMode: "CUSTODIAL", externalPublicKey: OWN })),
    );
    render(<WalletModeButton to="CUSTODIAL">Pay from HeyPay wallet</WalletModeButton>);

    await userEvent.click(screen.getByRole("button", { name: "Pay from HeyPay wallet" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("/api/wallet/external");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ walletMode: "CUSTODIAL" });
  });

  it("says why when the switch is refused, and stays on the page", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Connect your wallet first." } }), {
        status: 409,
      }),
    );
    render(<WalletModeButton to="EXTERNAL">Pay from Freighter</WalletModeButton>);

    await userEvent.click(screen.getByRole("button", { name: "Pay from Freighter" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Connect your wallet first.");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("HeyPayWalletAside", () => {
  it("shows what is left in the HeyPay wallet, who holds it, and that payments do not use it", () => {
    render(
      <HeyPayWalletAside
        holdings={{
          totalPhp: "148.75",
          hasUnpricedBalance: false,
          tokens: [
            { asset: "XLM", balance: "12.5000000", valuePhp: "148.75" },
            { asset: "USDC", balance: "0.0000000", valuePhp: "0.00" },
          ],
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "HeyPay wallet" })).toBeInTheDocument();
    expect(screen.getByText("HeyPay holds the key")).toBeInTheDocument();
    expect(screen.getByTestId("heypay-holding-XLM")).toHaveTextContent("12.5");
    expect(screen.getByText(/Not used while you pay from your own wallet/)).toBeInTheDocument();
    expect(screen.queryByText("Pays now")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay from HeyPay wallet" })).toBeInTheDocument();
  });
});

describe("FreighterStrip", () => {
  it("shows the connected wallet as not used, with a way to pay from it", () => {
    render(
      <FreighterStrip
        address={OWN}
        holdings={{
          totalPhp: "0",
          hasUnpricedBalance: false,
          tokens: [{ asset: "XLM", balance: "9991.5278264", valuePhp: null }],
        }}
      />,
    );
    expect(screen.getByText(/GDY2…UBH6/)).toBeInTheDocument();
    expect(screen.getByText(/connected, not used for payments/)).toBeInTheDocument();
    expect(screen.getByText(/9991.5278264/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay from Freighter" })).toBeInTheDocument();
  });

  it("leaves the balance out when Stellar could not be read", () => {
    render(<FreighterStrip address={OWN} holdings={null} />);
    expect(screen.queryByText(/XLM/)).not.toBeInTheDocument();
  });
});
