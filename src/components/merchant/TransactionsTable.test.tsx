import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { TransactionsTable } from "./TransactionsTable";
import type { MerchantTxItem } from "@/server/merchant/service";

const row: MerchantTxItem = {
  id: "p1",
  reference: "TXN-AAAA1111",
  customer: "juan",
  asset: "XLM" as const,
  amountAsset: "18.7500000",
  amountPhp: "150.00",
  netSettledPhp: "148.50",
  status: "SETTLED",
  createdAt: new Date().toISOString(),
};

it("renders customer, amounts, and a status badge", () => {
  render(<TransactionsTable items={[row]} />);
  expect(screen.getByText("juan")).toBeInTheDocument();
  expect(screen.getByText("18.7500000 XLM")).toBeInTheDocument();
  expect(screen.getByText("Settled")).toBeInTheDocument();
});

it("renders an empty state with no items", () => {
  render(<TransactionsTable items={[]} />);
  expect(screen.getByText("No transactions yet.")).toBeInTheDocument();
});
