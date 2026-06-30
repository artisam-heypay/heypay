// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { dec } from "@/lib/money";
import { RecentPaymentsList, type RecentPaymentItem } from "./RecentPaymentsList";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(cleanup);

const items: RecentPaymentItem[] = [
  {
    id: "p1",
    reference: "TXN-AAAAAAAA",
    merchantName: "Kape Co",
    amountXlm: dec("8.3333334"),
    amountPhp: dec("100.00"),
    status: "SETTLED",
    createdAt: new Date("2026-06-30T00:00:00Z"),
  },
  {
    id: "p2",
    reference: "TXN-BBBBBBBB",
    merchantName: "Tindahan",
    amountXlm: dec("4.0"),
    amountPhp: dec("48.00"),
    status: "PDAX_TRADING",
    createdAt: new Date("2026-06-29T00:00:00Z"),
  },
];

describe("RecentPaymentsList", () => {
  it("renders a row per payment with merchant, money, and status", () => {
    const { getByText, container } = render(<RecentPaymentsList items={items} />);
    expect(getByText("Kape Co")).toBeTruthy();
    expect(getByText("Tindahan")).toBeTruthy();
    expect(container.textContent).toContain("8.3333334 XLM");
    expect(getByText("Settled")).toBeTruthy();
    expect(getByText("Pending")).toBeTruthy(); // PDAX_TRADING → Pending
  });

  it("renders an empty state with a Scan-to-Pay CTA when there are no payments", () => {
    const { getByText, getByRole } = render(<RecentPaymentsList items={[]} />);
    expect(getByText(/no payments yet/i)).toBeTruthy();
    expect(getByRole("button", { name: /scan to pay/i })).toBeTruthy();
  });
});
