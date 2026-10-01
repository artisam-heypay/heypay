import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TransactionList } from "./TransactionList";
import type { PayerPaymentListItem } from "@/server/payer/data";

vi.mock("next/navigation", () => ({ usePathname: () => "/payer/transactions" }));

const item = (id: string): PayerPaymentListItem => ({
  id,
  reference: `TXN-${id}`,
  merchantName: `Store ${id}`,
  merchantCity: "Manila",
  asset: "XLM" as const,
  amountAsset: "8.3300000 XLM",
  amountPhp: "₱100.00",
  status: "SETTLED",
  createdAt: new Date("2026-06-30T00:00:00Z").toISOString(),
});

describe("TransactionList", () => {
  it("renders initial rows", () => {
    render(<TransactionList initial={[item("a"), item("b")]} loadMore={vi.fn()} />);
    expect(screen.getByText("Store a")).toBeInTheDocument();
    expect(screen.getByText("Store b")).toBeInTheDocument();
  });

  it("renders an empty state when there are no items", () => {
    render(<TransactionList initial={[]} loadMore={vi.fn()} />);
    expect(screen.getByText("No transactions yet")).toBeInTheDocument();
  });

  it("Load more appears only with a cursor and appends rows", async () => {
    const loadMore = vi.fn().mockResolvedValue({ items: [item("c")], nextCursor: undefined });
    render(<TransactionList initial={[item("a")]} initialCursor="cur" loadMore={loadMore} />);
    const btn = screen.getByRole("button", { name: "Load more" });
    await userEvent.click(btn);
    expect(loadMore).toHaveBeenCalledWith("cur");
    expect(await screen.findByText("Store c")).toBeInTheDocument();
  });
});
