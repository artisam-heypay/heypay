import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/payer/dashboard" }));

import { SideNav } from "./SideNav";

describe("SideNav", () => {
  it("marks the active route and styles the logout link as error", () => {
    render(<SideNav username="alice" />);
    const dashboard = screen.getByRole("link", { name: /Dashboard/ });
    expect(dashboard).toHaveAttribute("aria-current", "page");
    expect(dashboard.className).toContain("bg-primary-container");

    const logout = screen.getByRole("link", { name: /Logout/ });
    expect(logout.className).toContain("text-error");
  });

  it("renders a Scan to Pay action linking to /payer/scan", () => {
    render(<SideNav username="alice" />);
    expect(screen.getByRole("link", { name: /Scan to Pay/ })).toHaveAttribute(
      "href",
      "/payer/scan",
    );
  });
});
