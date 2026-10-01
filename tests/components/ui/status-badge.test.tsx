import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import { StatusBadge } from "@/components/ui/StatusBadge";

it("renders a textual settled label with a dot", () => {
  render(<StatusBadge status="SETTLED" />);
  expect(screen.getByText("Settled")).toBeInTheDocument();
  expect(screen.getByTestId("status-dot")).toBeInTheDocument();
});

it("renders pending tone for an in-flight trade", () => {
  render(<StatusBadge status="PDAX_TRADING" />);
  expect(screen.getByText("Pending Trade")).toBeInTheDocument();
});
