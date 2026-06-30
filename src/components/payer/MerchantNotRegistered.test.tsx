// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { MerchantNotRegistered } from "./MerchantNotRegistered";

afterEach(cleanup);

describe("MerchantNotRegistered", () => {
  it("renders the empty state with a Scan-again button and a dashboard link", () => {
    const { getByText, getByRole } = render(<MerchantNotRegistered />);
    expect(getByText(/merchant not registered/i)).toBeTruthy();
    expect(getByText(/isn.t set up to receive heypay/i)).toBeTruthy();
    expect(getByRole("button", { name: /scan again/i })).toBeTruthy();
    const back = getByRole("link", { name: /back to dashboard/i });
    expect(back.getAttribute("href")).toBe("/payer/dashboard");
  });
});
