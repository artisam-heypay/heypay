import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AmountPrompt } from "./AmountPrompt";

function mockWallet(rate: string | null, available = "50.0000000") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ assets: [{ asset: "XLM", rate, available }] }),
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("AmountPrompt", () => {
  it("submits a PHP amount as-is and previews the XLM cost", async () => {
    mockWallet("20.00000000");
    const onSubmit = vi.fn();
    render(<AmountPrompt onSubmit={onSubmit} />);
    await screen.findByText(/1 XLM ≈ ₱20.00/);

    fireEvent.change(screen.getByLabelText("Amount to pay (PHP)"), { target: { value: "100" } });
    expect(screen.getByText("≈ 5.0000000 XLM")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(onSubmit).toHaveBeenCalledWith("100.00");
  });

  it("converts an XLM amount to PHP before submitting", async () => {
    mockWallet("20.00000000");
    const onSubmit = vi.fn();
    render(<AmountPrompt onSubmit={onSubmit} />);
    await screen.findByText(/1 XLM ≈ ₱20.00/);

    fireEvent.click(screen.getByRole("radio", { name: "XLM" }));
    fireEvent.change(screen.getByLabelText("Amount to pay (XLM)"), { target: { value: "2.5" } });
    expect(screen.getByText("≈ ₱50.00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(onSubmit).toHaveBeenCalledWith("50.00");
  });

  it("carries the amount across when switching currency", async () => {
    mockWallet("20.00000000");
    render(<AmountPrompt onSubmit={vi.fn()} />);
    await screen.findByText(/1 XLM ≈ ₱20.00/);

    fireEvent.change(screen.getByLabelText("Amount to pay (PHP)"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("radio", { name: "XLM" }));
    expect(screen.getByLabelText("Amount to pay (XLM)")).toHaveValue("5.0000000");
  });

  it("warns when the amount exceeds the available XLM", async () => {
    mockWallet("20.00000000", "1.0000000");
    render(<AmountPrompt onSubmit={vi.fn()} />);
    await screen.findByText(/1 XLM ≈ ₱20.00/);

    fireEvent.change(screen.getByLabelText("Amount to pay (PHP)"), { target: { value: "100" } });
    expect(screen.getByText("This is more than your available XLM.")).toBeInTheDocument();
  });

  it("refuses XLM entry when no rate is available", async () => {
    mockWallet(null);
    const onSubmit = vi.fn();
    render(<AmountPrompt onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("radio", { name: "XLM" }));
    fireEvent.change(screen.getByLabelText("Amount to pay (XLM)"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/XLM rate is unavailable/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  describe("for a payer who pays from their own wallet", () => {
    /** /api/wallet is the HeyPay wallet; /api/wallet/external is their Freighter. */
    function mockWallets(own: { walletMode: string; available?: string | null }) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(async (url: string) =>
          url === "/api/wallet/external"
            ? {
                ok: true,
                json: async () => ({
                  walletMode: own.walletMode,
                  externalPublicKey: "GDY2RNPWRZCEROBS2YJIHG7QDXVJ7VNF7XTFL2R4GJO4OAWI3LQ7UBH6",
                  holdings:
                    own.available === null
                      ? null
                      : { tokens: [{ asset: "XLM", available: own.available }] },
                }),
              }
            : {
                ok: true,
                json: async () => ({
                  assets: [{ asset: "XLM", rate: "11.55000000", available: "0.0000000" }],
                }),
              },
        ),
      );
    }

    it("checks the amount against Freighter, not the empty HeyPay wallet", async () => {
      mockWallets({ walletMode: "EXTERNAL", available: "9524.3000000" });
      render(<AmountPrompt onSubmit={vi.fn()} />);
      await screen.findByText(/Available in Freighter: 9524.3000000 XLM/);

      fireEvent.change(screen.getByLabelText("Amount to pay (PHP)"), { target: { value: "234" } });

      expect(screen.queryByText(/more than/)).not.toBeInTheDocument();
    });

    it("warns, in Freighter's terms, when the amount is more than Freighter can spend", async () => {
      mockWallets({ walletMode: "EXTERNAL", available: "10.0000000" });
      render(<AmountPrompt onSubmit={vi.fn()} />);
      await screen.findByText(/Available in Freighter/);

      fireEvent.change(screen.getByLabelText("Amount to pay (PHP)"), { target: { value: "234" } });

      expect(
        screen.getByText("This is more than the XLM you can spend in Freighter."),
      ).toBeInTheDocument();
    });

    it("checks nothing here when Freighter could not be read, and never the HeyPay wallet", async () => {
      mockWallets({ walletMode: "EXTERNAL", available: null });
      const onSubmit = vi.fn();
      render(<AmountPrompt onSubmit={onSubmit} />);
      await screen.findByText(/1 XLM ≈ ₱11.55/);

      fireEvent.change(screen.getByLabelText("Amount to pay (PHP)"), { target: { value: "234" } });

      expect(screen.queryByText(/Available/)).not.toBeInTheDocument();
      expect(screen.queryByText(/more than/)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
      expect(onSubmit).toHaveBeenCalledWith("234.00");
    });

    it("keeps checking the HeyPay wallet for a payer who pays from it", async () => {
      mockWallets({ walletMode: "CUSTODIAL", available: "9524.3000000" });
      render(<AmountPrompt onSubmit={vi.fn()} />);
      await screen.findByText("Available: 0.0000000 XLM");

      fireEvent.change(screen.getByLabelText("Amount to pay (PHP)"), { target: { value: "234" } });

      expect(screen.getByText("This is more than your available XLM.")).toBeInTheDocument();
    });
  });
});
