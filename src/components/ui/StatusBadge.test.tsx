import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("shows the 'Settled' label and a dot (not color alone)", () => {
    render(<StatusBadge status="SETTLED" />);
    expect(screen.getByText("Settled")).toBeInTheDocument();
    expect(screen.getByTestId("status-dot")).toBeInTheDocument();
  });

  it("shows a granular pending label with a pulsing dot for in-flight states", () => {
    render(<StatusBadge status="PDAX_TRADING" />);
    expect(screen.getByText("Pending Trade")).toBeInTheDocument();
    expect(screen.getByTestId("status-dot").className).toContain("animate-status-pulse");
  });

  it("shows 'Failed' in error styling", () => {
    render(<StatusBadge status="FAILED" />);
    const label = screen.getByText("Failed");
    expect(label).toBeInTheDocument();
    expect(label.className).toContain("text-error");
  });
});
