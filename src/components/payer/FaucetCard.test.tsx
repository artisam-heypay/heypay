import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FaucetCard } from "./FaucetCard";
import { WALLET_UPDATED_EVENT } from "./HoldingsLive";

function mockFetch(ok: boolean, body: unknown) {
  const fetch = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe("FaucetCard", () => {
  it("claims test XLM, links the transaction and refreshes the balance", async () => {
    const fetch = mockFetch(true, { txUrl: "https://stellar.expert/explorer/testnet/tx/abc" });
    const onUpdated = vi.fn();
    window.addEventListener(WALLET_UPDATED_EVENT, onUpdated);

    render(<FaucetCard amountXlm="20.0000000" />);
    fireEvent.click(screen.getByRole("button", { name: /Claim 20 XLM/ }));

    expect(await screen.findByText(/20 XLM is on its way/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View transaction" })).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/tx/abc",
    );
    expect(fetch).toHaveBeenCalledWith("/api/wallet/faucet", { method: "POST" });
    expect(onUpdated).toHaveBeenCalledTimes(1);
    window.removeEventListener(WALLET_UPDATED_EVENT, onUpdated);
  });

  it("shows the server's reason when the claim is refused", async () => {
    mockFetch(false, { error: { message: "You have already claimed your test XLM." } });
    render(<FaucetCard amountXlm="20.0000000" />);
    fireEvent.click(screen.getByRole("button", { name: /Claim 20 XLM/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You have already claimed your test XLM.",
    );
    expect(screen.getByRole("button", { name: /Claim 20 XLM/ })).toBeEnabled();
  });
});
