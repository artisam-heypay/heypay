import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DepositCard } from "./DepositCard";

describe("DepositCard", () => {
  it("shows the full address, copy control, network reminder, and QR", () => {
    render(<DepositCard publicKey="GABC123" qrSvg="<svg data-testid='qr'></svg>" />);
    expect(screen.getByText("GABC123")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy deposit address" })).toBeInTheDocument();
    expect(
      screen.getByText(/Send only XLM on the Stellar network\. No memo is required\./),
    ).toBeInTheDocument();
  });
});
