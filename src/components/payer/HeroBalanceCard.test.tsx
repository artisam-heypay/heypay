// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { HeroBalanceCard } from "./HeroBalanceCard";

afterEach(cleanup);

describe("HeroBalanceCard", () => {
  it("shows the XLM balance (primary) + PHP reference and the Prefund/Send pills", () => {
    const { container, getByRole } = render(
      <HeroBalanceCard availableXlm="250.0000000" approxPhp="14850.00" />,
    );
    expect(container.textContent).toContain("250.0000000 XLM");
    expect(container.textContent).toContain("₱14,850.00");
    const prefund = getByRole("button", { name: /prefund/i });
    expect(prefund.className).toContain("bg-primary");
    const send = getByRole("button", { name: /send/i });
    expect(send.className).toContain("border-primary");
  });
});
