import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecentPaymentsList } from "./RecentPaymentsList";
import { dec } from "@/lib/money";
import type { RecentPayment } from "@/server/payer/data";

const rows: RecentPayment[] = [
  {
    id: "p1",
    reference: "TXN-AAAAAAAA",
    merchantName: "Sari Store",
    merchantCity: "Manila",
    amountXlm: dec("8.33"),
    amountPhp: dec("100"),
    status: "SETTLED",
    createdAt: new Date("2026-06-30T00:00:00Z").toISOString(),
  },
  {
    id: "p2",
    reference: "TXN-BBBBBBBB",
    merchantName: "Cafe Luna",
    merchantCity: null,
    amountXlm: dec("4"),
    amountPhp: dec("48"),
    status: "PDAX_TRADING",
    createdAt: new Date("2026-06-29T00:00:00Z").toISOString(),
  },
];

describe("RecentPaymentsList", () => {
  it("renders rows with merchant, money, and status badges", () => {
    render(<RecentPaymentsList payments={rows} />);
    expect(screen.getByText("Sari Store")).toBeInTheDocument();
    expect(screen.getByText("Cafe Luna")).toBeInTheDocument();
    expect(screen.getByText("Settled")).toBeInTheDocument();
    expect(screen.getByText("Pending Trade")).toBeInTheDocument();
    expect(screen.getByText("8.3300000 XLM")).toBeInTheDocument();
  });

  it("renders an empty state with a Scan CTA", () => {
    render(<RecentPaymentsList payments={[]} />);
    expect(screen.getByText("No payments yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Scan to Pay/ })).toHaveAttribute(
      "href",
      "/payer/scan",
    );
  });
});
