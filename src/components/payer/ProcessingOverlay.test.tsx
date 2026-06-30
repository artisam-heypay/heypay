// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ProcessingOverlay } from "./ProcessingOverlay";

afterEach(cleanup);

describe("ProcessingOverlay", () => {
  it("shows completed + in-progress steps for an in-flight status", () => {
    const { container } = render(
      <ProcessingOverlay status="PDAX_TRADING" php="500.00" merchantName="Kape Co" />,
    );
    // an earlier step is done (check_circle) and the current step is active (sync + pulse)
    expect(container.textContent).toContain("check_circle");
    expect(container.textContent).toContain("sync");
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("shows the success headline (secondary) + Done on SETTLED", () => {
    const { getByText, getByRole } = render(
      <ProcessingOverlay status="SETTLED" php="500.00" merchantName="Kape Co" />,
    );
    const headline = getByText(/₱500\.00 sent to Kape Co/i);
    expect(headline.className).toContain("text-secondary");
    expect(getByRole("button", { name: /done/i })).toBeTruthy();
  });
});
