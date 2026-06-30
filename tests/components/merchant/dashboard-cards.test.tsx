// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { EarningsCards } from "@/components/merchant/EarningsCards";
import { TransactionsTable } from "@/components/merchant/TransactionsTable";
import type { MerchantTxItem } from "@/server/merchant/service";

afterEach(cleanup);

const tx: MerchantTxItem = {
  id: "t1",
  reference: "HP-ABC123",
  customer: "juan",
  amountXlm: "18.7500000",
  amountPhp: "150.00",
  netSettledPhp: "150.00",
  status: "SETTLED",
  createdAt: new Date().toISOString(),
};

describe("EarningsCards", () => {
  it("renders the formatted total and MoM change", () => {
    const { getByText } = render(
      <EarningsCards
        earnings={{ totalSettledPhp: "150.00", momChangePct: 12.5, pendingXlm: "18.7500000" }}
      />,
    );
    expect(getByText("Total Settled")).toBeTruthy();
    expect(getByText("₱150.00")).toBeTruthy();
    expect(getByText(/12\.5% vs last month/)).toBeTruthy();
  });
});

describe("TransactionsTable", () => {
  it("renders a settled customer row", () => {
    const { getByText } = render(<TransactionsTable items={[tx]} />);
    expect(getByText("juan")).toBeTruthy();
    expect(getByText("Settled")).toBeTruthy();
    expect(getByText("HP-ABC123")).toBeTruthy();
  });

  it("renders an empty state when there are no transactions", () => {
    const { getByText } = render(<TransactionsTable items={[]} />);
    expect(getByText("No transactions yet.")).toBeTruthy();
  });
});
