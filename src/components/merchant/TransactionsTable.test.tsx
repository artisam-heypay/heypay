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
  stellarTxUrl: "https://stellar.expert/explorer/testnet/tx/abc123",
  createdAt: new Date().toISOString(),
};

it("renders customer, amounts, and a status badge", () => {
  render(<TransactionsTable items={[row]} />);
  expect(screen.getByText("juan")).toBeInTheDocument();
  expect(screen.getByText("18.7500000 XLM")).toBeInTheDocument();
  expect(screen.getByText("Settled")).toBeInTheDocument();
});

it("links each sent payment to the Stellar explorer in a new tab", () => {
  render(<TransactionsTable items={[row]} />);
  const link = screen.getByRole("link", { name: /View on Stellar/ });
  expect(link).toHaveAttribute("href", "https://stellar.expert/explorer/testnet/tx/abc123");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

it("shows no explorer link before the payment reaches the chain", () => {
  render(<TransactionsTable items={[{ ...row, stellarTxUrl: null }]} />);
  expect(screen.queryByRole("link", { name: /View on Stellar/ })).toBeNull();
});

it("renders an empty state with no items", () => {
  render(<TransactionsTable items={[]} />);
  expect(screen.getByText("No transactions yet.")).toBeInTheDocument();
});
