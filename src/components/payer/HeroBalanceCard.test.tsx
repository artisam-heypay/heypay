import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeroBalanceCard } from "./HeroBalanceCard";
import { dec } from "@/lib/money";

// next/link renders an <a>; no special mock needed, but stub navigation just in case.
vi.mock("next/navigation", () => ({ usePathname: () => "/payer/dashboard" }));

describe("HeroBalanceCard", () => {
  it("shows the available XLM (display) + ≈PHP and Prefund/Send CTAs", () => {
    render(<HeroBalanceCard availableXlm={dec("250")} approxPhp={dec("14850.00")} live={false} />);
    expect(screen.getByText("250.0000000 XLM")).toBeInTheDocument();
    expect(screen.getByText(/₱14,850\.00/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Prefund/ })).toHaveAttribute("href", "/payer/prefund");
    expect(screen.getByRole("link", { name: /Send/ })).toHaveAttribute("href", "/payer/scan");
  });
});
