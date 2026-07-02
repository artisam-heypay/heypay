import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProcessingOverlay } from "./ProcessingOverlay";

describe("ProcessingOverlay", () => {
  it("shows the checklist with in-progress step while trading", () => {
    render(
      <ProcessingOverlay
        status="PDAX_TRADING"
        merchantName="Sari Store"
        amountPhpDisplay="₱500.00"
      />,
    );
    expect(screen.getByText("Converting XLM → PHP")).toBeInTheDocument();
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
});
