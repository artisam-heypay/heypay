import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/payer/dashboard" }));

import { MobileNav } from "./MobileNav";

describe("MobileNav", () => {
  it("renders 4 nav links plus a Scan FAB, hidden on lg", () => {
    const { container } = render(<MobileNav />);
    // 4 nav items + 1 FAB = 5 links
    expect(screen.getAllByRole("link")).toHaveLength(5);
    const fab = screen.getByRole("link", { name: "Scan to Pay" });
    expect(fab).toHaveAttribute("href", "/payer/scan");
    expect(fab.className).toContain("min-h-11");
    expect(container.querySelector("nav")?.className).toContain("lg:hidden");
  });
});
