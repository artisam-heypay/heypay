// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { dec } from "@/lib/money";
import { ConversionBreakdown } from "./ConversionBreakdown";

afterEach(cleanup);

describe("ConversionBreakdown", () => {
  it("shows requested PHP, the rate, the network fee, and the total XLM deduction", () => {
    const { container } = render(
      <ConversionBreakdown
        amountPhp={dec("500.00")}
        quotedRate={dec("59.40")}
        amountXlm={dec("8.4175084")}
        networkFeeXlm={dec("0.00001")}
      />,
    );
    expect(container.textContent).toContain("₱500.00");
    expect(container.textContent).toContain("1 XLM = ₱59.40");
    expect(container.textContent).toContain("0.0000100 XLM"); // network fee
    expect(container.textContent).toContain("8.4175184 XLM"); // total = amount + fee
  });
});
