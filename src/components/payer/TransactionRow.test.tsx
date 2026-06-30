// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { TransactionRow } from "./TransactionRow";
import type { PayerPaymentListItem } from "@/server/payer/data";

afterEach(cleanup);

const item: PayerPaymentListItem = {
  id: "p1",
  reference: "TXN-AAAAAAAA",
  merchantName: "Kape Co",
  merchantCity: "Manila",
  amountXlm: "8.3333334 XLM",
  amountPhp: "₱100.00",
  status: "SETTLED",
  createdAt: "2026-06-30T00:00:00Z",
};

describe("TransactionRow", () => {
  it("shows merchant, money, status and opens the drawer on click", () => {
    const onOpen = vi.fn();
    const { getByRole, getByText } = render(<TransactionRow item={item} onOpen={onOpen} />);
    expect(getByText("Kape Co")).toBeTruthy();
    expect(getByText("8.3333334 XLM")).toBeTruthy();
    expect(getByText("Settled")).toBeTruthy();
    const btn = getByRole("button");
    expect(btn.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledWith("p1");
  });
});
