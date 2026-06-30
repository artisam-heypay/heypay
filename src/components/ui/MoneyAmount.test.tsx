// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { dec } from "@/lib/money";
import { MoneyAmount } from "./MoneyAmount";

afterEach(cleanup);

describe("MoneyAmount", () => {
  it("shows XLM (primary, 7dp) and PHP (human reference)", () => {
    const { container } = render(<MoneyAmount xlm={dec("12.5")} php={dec("742.10")} />);
    expect(container.textContent).toContain("12.5000000 XLM");
    expect(container.textContent).toContain("₱742.10");
  });
});
