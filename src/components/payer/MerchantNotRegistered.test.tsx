import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MerchantNotRegistered } from "./MerchantNotRegistered";

describe("MerchantNotRegistered", () => {
  it("renders the empty state with scan-again + dashboard actions", () => {
    render(<MerchantNotRegistered />);
    expect(screen.getByText("Merchant not registered")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan again" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toHaveAttribute(
      "href",
      "/payer/dashboard",
    );
  });
});
