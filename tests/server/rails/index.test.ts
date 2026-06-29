import { describe, it, expect } from "vitest";
import { selectRail } from "@/server/rails/index";
import { mockProvider } from "@/server/rails/mock";
import { pdaxProvider } from "@/server/rails/pdax";

describe("selectRail", () => {
  it("returns the PDAX provider for PAYMENT_RAIL=pdax", () => {
    expect(selectRail("pdax")).toBe(pdaxProvider);
  });
  it("returns the mock provider for PAYMENT_RAIL=mock", () => {
    expect(selectRail("mock")).toBe(mockProvider);
  });
  it("defaults to the mock provider when unset or unknown", () => {
    expect(selectRail(undefined)).toBe(mockProvider);
    expect(selectRail("nonsense")).toBe(mockProvider);
  });
});
