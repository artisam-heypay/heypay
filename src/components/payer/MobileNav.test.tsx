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

import { MobileNav } from "./MobileNav";

afterEach(cleanup);

describe("MobileNav", () => {
  it("renders the 4 nav items (each a >=44px tap target) and is hidden on lg", () => {
    const { getByRole, container } = render(<MobileNav />);
    for (const label of ["Dashboard", "History", "Prefund", "Settings"]) {
      const link = getByRole("link", { name: new RegExp(label, "i") });
      expect(link.className).toContain("min-h-11");
    }
    expect(container.querySelector("nav")!.className).toContain("lg:hidden");
  });

  it("renders a centered Scan-to-Pay FAB linking to /payer/scan", () => {
    const { getByLabelText } = render(<MobileNav />);
    const fab = getByLabelText("Scan to Pay");
    expect(fab.getAttribute("href")).toBe("/payer/scan");
    expect(fab.className).toContain("rounded-full");
  });
});
