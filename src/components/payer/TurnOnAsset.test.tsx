import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TurnOnAsset } from "./TurnOnAsset";

const TX_URL = "https://stellar.expert/explorer/testnet/tx/abc123";

afterEach(() => vi.restoreAllMocks());

describe("TurnOnAsset", () => {
  it("explains the step in plain words and offers one button while the asset is off", () => {
    render(<TurnOnAsset asset="USDC" on={false} />);
    expect(screen.getByText(/Turn on USDC so your wallet can hold it/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Turn on USDC/ })).toBeInTheDocument();
  });

  it("shows that the asset is on, with no button, when it already is", () => {
    render(<TurnOnAsset asset="USDC" on txUrl={TX_URL} />);
    expect(screen.getByText(/USDC is on/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View transaction" })).toHaveAttribute("href", TX_URL);
  });

  it("shows no transaction link when the trustline was not made by HeyPay", () => {
    render(<TurnOnAsset asset="USDC" on />);
    expect(screen.getByText(/USDC is on/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("submits the change_trust and links to the transaction that did it", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ asset: "USDC", txHash: "abc123", txUrl: TX_URL }), {
        status: 200,
      }),
    );
    const onTurnedOn = vi.fn();
    render(<TurnOnAsset asset="USDC" on={false} onTurnedOn={onTurnedOn} />);

    await user.click(screen.getByRole("button", { name: /Turn on USDC/ }));

    expect(await screen.findByText(/USDC is on/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View transaction" })).toHaveAttribute("href", TX_URL);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(onTurnedOn).toHaveBeenCalledWith(TX_URL);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/wallet/trustline",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ asset: "USDC" }) }),
    );
  });

  it("says why it was refused and keeps the button for another try", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "Fund your wallet with at least 1.0 XLM first." } }),
        { status: 409 },
      ),
    );
    render(<TurnOnAsset asset="USDC" on={false} />);

    await user.click(screen.getByRole("button", { name: /Turn on USDC/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Fund your wallet with at least 1.0 XLM first.",
    );
    expect(screen.getByRole("button", { name: /Turn on USDC/ })).toBeInTheDocument();
  });
});
