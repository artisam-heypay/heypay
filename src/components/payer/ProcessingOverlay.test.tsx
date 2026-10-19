import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProcessingOverlay } from "./ProcessingOverlay";

describe("ProcessingOverlay", () => {
  it("shows the checklist with in-progress step while paying out", () => {
    render(
      <ProcessingOverlay
        status="PAYOUT_SUBMITTED"
        merchantName="Sari Store"
        amountPhpDisplay="₱500.00"
      />,
    );
    expect(screen.getByText("Paying the merchant in PHP")).toBeInTheDocument();
    expect(screen.getByText("Payment authorized")).toBeInTheDocument();
  });

  it("shows success headline + Done on SETTLED", () => {
    render(
      <ProcessingOverlay status="SETTLED" merchantName="Sari Store" amountPhpDisplay="₱500.00" />,
    );
    const heading = screen.getByRole("heading", { name: /₱500\.00 sent to Sari Store/ });
    expect(heading.className).toContain("text-secondary");
    expect(screen.getByRole("link", { name: "Done" })).toHaveAttribute(
      "href",
      "/payer/transactions",
    );
  });

  it("says plainly that the merchant was not paid, without the server's reason", () => {
    render(
      <ProcessingOverlay status="FAILED" merchantName="Sari Store" amountPhpDisplay="₱500.00" />,
    );
    expect(screen.getByRole("heading", { name: "Payment didn't go through" })).toBeInTheDocument();
    expect(screen.getByText("We couldn't pay Sari Store.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pay again" })).toHaveAttribute("href", "/payer/scan");
  });

  it("gives the reason the confirm screen found, when there is one", () => {
    render(
      <ProcessingOverlay
        status="FAILED"
        merchantName="Sari Store"
        amountPhpDisplay="₱500.00"
        failureReason="You closed Freighter before approving."
      />,
    );
    expect(screen.getByText("You closed Freighter before approving.")).toBeInTheDocument();
  });

  it("says the money is being returned, and offers Pay again only once it is back", () => {
    const { rerender } = render(
      <ProcessingOverlay
        status="REFUND_PENDING"
        merchantName="Sari Store"
        amountPhpDisplay="₱500.00"
      />,
    );
    expect(screen.getByRole("heading", { name: "Payment didn't go through" })).toBeInTheDocument();
    expect(screen.getByText("Your ₱500.00 is being returned to your wallet.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Pay again" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toBeInTheDocument();

    rerender(
      <ProcessingOverlay status="REFUNDED" merchantName="Sari Store" amountPhpDisplay="₱500.00" />,
    );
    expect(screen.getByRole("heading", { name: "Payment refunded" })).toBeInTheDocument();
    expect(screen.getByText("Your ₱500.00 is back in your wallet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pay again" })).toHaveAttribute("href", "/payer/scan");
  });

  it("shows a refund as money back, not as an error", () => {
    render(
      <ProcessingOverlay status="REFUNDED" merchantName="Sari Store" amountPhpDisplay="₱500.00" />,
    );
    const heading = screen.getByRole("heading", { name: "Payment refunded" });
    expect(heading.className).not.toContain("text-error");
    expect(heading.className).toContain("text-on-surface");
  });

  it("says in plain words that the shop's bank refused the transfer", () => {
    render(
      <ProcessingOverlay
        status="REFUND_PENDING"
        merchantName="Sari Store"
        amountPhpDisplay="₱500.00"
        bankRefused
      />,
    );
    expect(
      screen.getByText("We couldn't pay Sari Store: their bank didn't accept the transfer."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/INVALID_DESTINATION|disb-/)).not.toBeInTheDocument();
  });

  it("shows a cancelled payment as cancelled, not failed", () => {
    render(
      <ProcessingOverlay status="CANCELLED" merchantName="Sari Store" amountPhpDisplay="₱500.00" />,
    );
    expect(screen.getByRole("heading", { name: "Payment cancelled" })).toBeInTheDocument();
    expect(screen.queryByText("Processing payment…")).not.toBeInTheDocument();
  });
});
