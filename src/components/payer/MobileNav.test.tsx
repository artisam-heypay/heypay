import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/payer/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import { MobileNav } from "./MobileNav";

describe("MobileNav", () => {
  beforeEach(() => {
    nav.pathname = "/payer/dashboard";
  });

  it("renders 4 nav links plus a Scan FAB, hidden on lg", () => {
    const { container } = render(<MobileNav />);
    // 4 nav items + 1 FAB = 5 links
    expect(screen.getAllByRole("link")).toHaveLength(5);
    const fab = screen.getByRole("link", { name: "Scan to Pay" });
    expect(fab).toHaveAttribute("href", "/payer/scan");
    expect(fab.className).toContain("min-h-11");
    expect(fab).toHaveTextContent("Pay");
    expect(container.querySelector("nav")?.className).toContain("lg:hidden");
  });

  it("is opaque, so the page does not show through its labels", () => {
    const { container } = render(<MobileNav />);
    const cls = container.querySelector("nav")?.className ?? "";
    expect(cls).toContain("bg-surface-container-lowest");
    expect(cls).not.toContain("glass");
  });

  it("is not shown on the confirm step", () => {
    nav.pathname = "/payer/pay/pay_123/confirm";
    const { container } = render(<MobileNav />);
    expect(container.querySelector("nav")).toBeNull();
  });
});
