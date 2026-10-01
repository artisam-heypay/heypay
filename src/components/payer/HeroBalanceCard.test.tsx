import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeroBalanceCard } from "./HeroBalanceCard";

vi.mock("next/navigation", () => ({ usePathname: () => "/payer/dashboard" }));

const holdings = {
  totalPhp: "14850.00",
  hasUnpricedBalance: false,
  tokens: [
    { asset: "XLM", balance: "250.0000000", valuePhp: "1825.00" },
    { asset: "USDC", balance: "200.0000000", valuePhp: "13025.00" },
  ],
};

describe("HeroBalanceCard", () => {
  it("shows the portfolio total, a row per token, and Prefund/Send CTAs", () => {
    render(<HeroBalanceCard holdings={holdings} live={false} />);
    expect(screen.getByText("₱14,850.00")).toBeInTheDocument();
    expect(screen.getByText("250.0000000 XLM")).toBeInTheDocument();
    expect(screen.getByText("200.0000000 USDC")).toBeInTheDocument();
    expect(screen.getByText(/₱13,025\.00/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Prefund/ })).toHaveAttribute("href", "/payer/prefund");
    expect(screen.getByRole("link", { name: /Send/ })).toHaveAttribute("href", "/payer/scan");
  });

  it("shows a dash and a caveat when a held token has no rate", () => {
    render(
      <HeroBalanceCard
        live={false}
        holdings={{
          totalPhp: "1825.00",
          hasUnpricedBalance: true,
          tokens: [
            { asset: "XLM", balance: "250.0000000", valuePhp: "1825.00" },
            { asset: "USDT", balance: "40.0000000", valuePhp: null },
          ],
        }}
      />,
    );
    // The unpriced token is still listed — the balance is real — but excluded
    // from the total rather than counted as zero.
    expect(screen.getByText("40.0000000 USDT")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText(/Excludes tokens with no available rate/)).toBeInTheDocument();
    expect(screen.getByText("₱1,825.00")).toBeInTheDocument();
  });
});
