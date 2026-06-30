// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { TransactionList } from "./TransactionList";
import type { PayerPaymentListItem } from "@/server/payer/data";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

afterEach(cleanup);

const mk = (id: string, name: string): PayerPaymentListItem => ({
  id,
  reference: `TXN-${id}`,
  merchantName: name,
  amountXlm: "1.0000000 XLM",
  amountPhp: "₱12.00",
  status: "SETTLED",
  createdAt: "2026-06-30T00:00:00Z",
});

describe("TransactionList", () => {
  it("renders an empty state with a Scan CTA when there are no items", () => {
    const { getByText, getByRole } = render(<TransactionList initial={[]} loadMore={vi.fn()} />);
    expect(getByText(/no transactions yet/i)).toBeTruthy();
    expect(getByRole("button", { name: /scan to pay/i })).toBeTruthy();
  });

  it("loads more and appends rows when a cursor is present", async () => {
    const loadMore = vi
      .fn()
      .mockResolvedValue({ items: [mk("p2", "Tindahan")], nextCursor: undefined });
    const { getByText, getByRole, queryByRole } = render(
      <TransactionList initial={[mk("p1", "Kape Co")]} nextCursor="cur1" loadMore={loadMore} />,
    );
    expect(getByText("Kape Co")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: /load more/i }));
    await waitFor(() => expect(getByText("Tindahan")).toBeTruthy());
    expect(loadMore).toHaveBeenCalledWith("cur1");
    expect(queryByRole("button", { name: /load more/i })).toBeNull(); // no next cursor → gone
  });
});
