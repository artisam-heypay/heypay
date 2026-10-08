import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SwapList } from "./SwapList";
import type { PayerSwapListItem } from "@/server/payer/swap";

const item = (id: string, over: Partial<PayerSwapListItem> = {}): PayerSwapListItem => ({
  id,
  txUrl: `https://stellar.expert/explorer/testnet/tx/${id}`,
  sent: `${id}.0000000 XLM`,
  received: "0.9445859 USDC",
  createdAt: new Date("2026-10-08T00:00:00Z").toISOString(),
  ...over,
});

describe("SwapList", () => {
  it("shows both sides of each swap and links to its transaction", () => {
    render(<SwapList initial={[item("1")]} loadMore={vi.fn()} />);
    expect(screen.getByText("1.0000000 XLM → 0.9445859 USDC")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View transaction" })).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/tx/1",
    );
  });

  it("shows only what was sent when the received side is missing", () => {
    render(<SwapList initial={[item("1", { received: null })]} loadMore={vi.fn()} />);
    expect(screen.getByText("1.0000000 XLM")).toBeInTheDocument();
  });

  it("says so when there are no swaps", () => {
    render(<SwapList initial={[]} loadMore={vi.fn()} />);
    expect(screen.getByText("No swaps yet.")).toBeInTheDocument();
  });

  it("Load more appears only with a cursor and appends rows", async () => {
    const loadMore = vi.fn().mockResolvedValue({ items: [item("2")], nextCursor: undefined });
    render(<SwapList initial={[item("1")]} initialCursor="cur" loadMore={loadMore} />);
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(loadMore).toHaveBeenCalledWith("cur");
    expect(await screen.findByText(/^2\.0000000 XLM/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});
