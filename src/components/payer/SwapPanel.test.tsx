import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SwapPanel } from "./SwapPanel";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const BALANCES = { XLM: "100.0000000", USDC: "2.0000000" };
const TX_URL = "https://stellar.expert/explorer/testnet/tx/abc123";

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
const refusedWith = (message: string) =>
  ({ ok: false, json: async () => ({ error: { message } }) }) as Response;

afterEach(() => {
  vi.restoreAllMocks();
  refresh.mockClear();
});

describe("SwapPanel", () => {
  it("asks the payer to turn on USDC before showing the form", () => {
    render(<SwapPanel balances={BALANCES} usdcOn={false} />);
    expect(screen.getByRole("button", { name: /Turn on USDC/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Amount in/)).not.toBeInTheDocument();
  });

  it("says on Testnet that the prices are not market prices, and nowhere else", () => {
    const { unmount } = render(<SwapPanel balances={BALANCES} usdcOn testnet />);
    expect(screen.getByText(/Testnet prices do not reflect market prices/)).toBeInTheDocument();
    unmount();

    render(<SwapPanel balances={BALANCES} usdcOn />);
    expect(
      screen.queryByText(/Testnet prices do not reflect market prices/),
    ).not.toBeInTheDocument();
  });

  it("quotes XLM to USDC as the payer types, then swaps and links to the transaction", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (String(url).startsWith("/api/wallet/swap/quote")) {
        return ok({
          from: "XLM",
          to: "USDC",
          mode: "strict_send",
          amount: "10.0000000",
          estimated: "9.4458598",
          minReceived: "9.3514012",
        });
      }
      expect(JSON.parse(String(init?.body))).toEqual({
        from: "XLM",
        amount: "10.0000000",
        minReceived: "9.3514012",
      });
      return ok({
        txHash: "abc123",
        txUrl: TX_URL,
        from: "XLM",
        to: "USDC",
        sent: "10.0000000",
        received: "9.4458598",
      });
    });

    render(<SwapPanel balances={BALANCES} usdcOn />);
    const swap = screen.getByRole("button", { name: "Swap to USDC" });
    expect(swap).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Amount in XLM"), "10");
    expect(await screen.findByText("9.3514012 USDC")).toBeInTheDocument();
    expect(screen.getByText("Minimum received")).toBeInTheDocument();
    expect(screen.getByText("9.4458598 USDC")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/wallet/swap/quote?from=XLM&amount=10");

    await userEvent.click(swap);
    expect(
      await screen.findByText(/Swapped 10.0000000 XLM for 9.4458598 USDC/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View transaction" })).toHaveAttribute("href", TX_URL);
    expect(refresh).toHaveBeenCalled();
  });

  it("quotes USDC to XLM as the most paid and the exact amount received", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({
        from: "USDC",
        to: "XLM",
        mode: "strict_receive",
        amount: "1.0000000",
        estimated: "6.9753911",
        minReceived: "6.9056371",
      }),
    );
    render(<SwapPanel balances={BALANCES} usdcOn />);
    await userEvent.click(screen.getByRole("radio", { name: /USDC/ }));
    await userEvent.type(screen.getByLabelText("Amount in USDC"), "1");

    expect(await screen.findByText("6.9056371 XLM")).toBeInTheDocument();
    expect(screen.getByText("You pay at most")).toBeInTheDocument();
    expect(screen.getByText("1.0000000 USDC")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Swap to XLM" })).toBeEnabled();
  });

  it("shows why there is no price and keeps the button off", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      refusedWith("There are no offers to swap this amount right now. Try a smaller amount."),
    );
    render(<SwapPanel balances={BALANCES} usdcOn />);
    await userEvent.type(screen.getByLabelText("Amount in XLM"), "999999");
    expect(await screen.findByText(/There are no offers to swap this amount/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Swap to USDC" })).toBeDisabled();
  });

  it("shows the reason when the swap is refused", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      String(url).startsWith("/api/wallet/swap/quote")
        ? ok({
            from: "XLM",
            to: "USDC",
            mode: "strict_send",
            amount: "10.0000000",
            estimated: "9.4458598",
            minReceived: "9.3514012",
          })
        : refusedWith("The price changed. Check the new amount and swap again."),
    );
    render(<SwapPanel balances={BALANCES} usdcOn />);
    await userEvent.type(screen.getByLabelText("Amount in XLM"), "10");
    await screen.findByText("9.3514012 USDC");
    await userEvent.click(screen.getByRole("button", { name: "Swap to USDC" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/The price changed/));
  });
});
