// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/payer/dashboard" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { SideNav } from "./SideNav";

afterEach(cleanup);

describe("SideNav", () => {
  it("marks the active route with aria-current + active styling", () => {
    const { getByRole } = render(<SideNav username="alice" />);
    const dash = getByRole("link", { name: /dashboard/i });
    expect(dash.getAttribute("aria-current")).toBe("page");
    expect(dash.className).toContain("bg-primary-container");
  });

  it("shows Logout in error styling and a Scan-to-Pay pill linking to /payer/scan", () => {
    const { getByRole } = render(<SideNav username="alice" />);
    const logout = getByRole("link", { name: /logout/i });
    expect(logout.className).toContain("text-error");
    const scan = getByRole("link", { name: /scan to pay/i });
    expect(scan.getAttribute("href")).toBe("/payer/scan");
  });
});
