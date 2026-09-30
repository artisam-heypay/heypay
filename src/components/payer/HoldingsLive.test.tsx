import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { HoldingsLive } from "./HoldingsLive";

afterEach(() => vi.unstubAllGlobals());

const initial = {
  totalPhp: "700.00",
  hasUnpricedBalance: false,
  tokens: [{ asset: "XLM", balance: "50.0000000", valuePhp: "700.00", rate: "14.00000000" }],
};

describe("HoldingsLive", () => {
  it("shows the per-token rate next to its value", () => {
    render(<HoldingsLive initial={initial} live={false} />);
    expect(screen.getByText("1 XLM = ₱14.00")).toBeInTheDocument();
  });

  it("refreshes on mount so the value follows the current price", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          totalPhp: "750.00",
          hasUnpricedBalance: false,
          assets: [
            { asset: "XLM", balance: "50.0000000", valuePhp: "750.00", rate: "15.00000000" },
          ],
        }),
      }),
    );
    render(<HoldingsLive initial={initial} />);
    expect(await screen.findByText("1 XLM = ₱15.00")).toBeInTheDocument();
    expect(screen.getByText("₱750.00")).toBeInTheDocument();
  });
});
