import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./Button";

describe("Button", () => {
  it("renders a rounded-full primary pill with an accessible name", () => {
    render(<Button variant="primary-pill">Pay now</Button>);
    const btn = screen.getByRole("button", { name: "Pay now" });
    expect(btn.className).toContain("rounded-full");
  });

  it("disables and exposes aria-busy when loading", () => {
    render(<Button loading>Pay now</Button>);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });

  it("renders a trailing icon", () => {
    render(<Button trailingIcon="arrow_forward">Next</Button>);
    expect(screen.getByText("arrow_forward")).toBeInTheDocument();
  });
});
