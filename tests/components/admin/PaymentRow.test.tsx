/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PaymentRow } from "@/components/admin/PaymentRow";

const row = {
  id: "p1",
  reference: "TXN-ABCD1234",
  status: "FAILED" as const,
  payerUsername: "alice",
  merchantName: "Sari Store",
  amountPhp: "100.00",
  asset: "XLM",
  amountAsset: "10.0000000",
  failureReason: "PDAX timeout",
  createdAt: "2026-06-28T00:00:00.000Z",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/retry"))
        return new Response(JSON.stringify({ status: "FAILED" }), { status: 200 });
      return new Response(
        JSON.stringify({
          ...row,
          events: [
            {
              id: "e1",
              fromStatus: "AUTHORIZED",
              toStatus: "STELLAR_SUBMITTED",
              detail: null,
              createdAt: "2026-06-28T00:00:01.000Z",
            },
            {
              id: "e2",
              fromStatus: "STELLAR_SUBMITTED",
              toStatus: "FAILED",
              detail: { reason: "PDAX timeout" },
              createdAt: "2026-06-28T00:00:02.000Z",
            },
          ],
          stellarTxHash: null,
          pdaxTradeRef: null,
          pdaxCashoutRef: null,
        }),
        { status: 200 },
      );
    }),
  );
});

afterEach(() => {
  cleanup();
});

describe("PaymentRow", () => {
  it("expands to load the event timeline", async () => {
    render(
      <table>
        <tbody>
          <PaymentRow row={row} />
        </tbody>
      </table>,
    );
    fireEvent.click(screen.getByRole("button", { name: /view timeline/i }));
    await waitFor(() =>
      expect(screen.getByText("AUTHORIZED → STELLAR_SUBMITTED")).toBeInTheDocument(),
    );
    expect(screen.getByText("STELLAR_SUBMITTED → FAILED")).toBeInTheDocument();
    expect(screen.getByText(/PDAX timeout/)).toBeInTheDocument();
  });

  it("retry asks for confirmation then POSTs", async () => {
    render(
      <table>
        <tbody>
          <PaymentRow row={row} />
        </tbody>
      </table>,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry payment/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm retry/i }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/admin/payments/p1/retry",
        expect.objectContaining({ method: "POST", credentials: "same-origin" }),
      ),
    );
  });
});
