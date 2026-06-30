// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import { StatusBadge } from "@/components/ui/StatusBadge";

afterEach(cleanup);

describe("StatusBadge (granular labels)", () => {
  it("renders a textual settled label with a dot", () => {
    render(<StatusBadge status="SETTLED" />);
    expect(screen.getByText("Settled")).toBeTruthy();
    expect(screen.getByTestId("status-dot")).toBeTruthy();
  });

  it("renders pending tone for an in-flight trade", () => {
    render(<StatusBadge status="PDAX_TRADING" />);
    expect(screen.getByText("Pending Trade")).toBeTruthy();
  });
});
