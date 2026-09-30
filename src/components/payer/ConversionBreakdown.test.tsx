import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConversionBreakdown } from "./ConversionBreakdown";
import { dec } from "@/lib/money";

describe("ConversionBreakdown", () => {
  it("shows requested PHP, the rate, network fee, and total XLM deduction", () => {
    render(
      <ConversionBreakdown
        amountPhp={dec("500.00")}
        quotedRate={dec("59.40")}
        amountAsset={dec("8.4175084")}
        networkFeeXlm={dec("0.00001")}
      />,
    );
    expect(screen.getByText("₱500.00")).toBeInTheDocument();
    expect(screen.getByText("1 XLM = ₱59.40")).toBeInTheDocument();
    expect(screen.getByText("0.0000100 XLM")).toBeInTheDocument();
    // total deduction = 8.4175084 + 0.0000100 = 8.4175184
    expect(screen.getByText("8.4175184 XLM")).toBeInTheDocument();
  });

  it("adds the escrow fee estimate to the deduction and labels it a maximum", () => {
    render(
      <ConversionBreakdown
        amountPhp={dec("500.00")}
        quotedRate={dec("59.40")}
        amountAsset={dec("8.4175084")}
        networkFeeXlm={dec("0.00001")}
        escrowFeeXlm={dec("0.2")}
      />,
    );
    expect(screen.getByText("up to 0.2000000 XLM")).toBeInTheDocument();
    expect(screen.getByText("Maximum deduction")).toBeInTheDocument();
    // 8.4175084 + 0.0000100 + 0.2000000
    expect(screen.getByText("8.6175184 XLM")).toBeInTheDocument();
  });
});
