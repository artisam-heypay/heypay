import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MoneyAmount } from "./MoneyAmount";
import { dec } from "@/lib/money";

describe("MoneyAmount", () => {
  it("renders both XLM (primary) and PHP (reference)", () => {
    render(<MoneyAmount xlm={dec("12.5")} php={dec("742.10")} />);
    expect(screen.getByText("12.5000000 XLM")).toBeInTheDocument();
    expect(screen.getByText(/₱742\.10/)).toBeInTheDocument();
  });
});
