import { describe, it, expect } from "vitest";
import { selectRail } from "@/server/rails/index";
import { mockProvider } from "@/server/rails/mock";
import { xenditProvider } from "@/server/rails/xendit";

describe("selectRail", () => {
  it("returns the Xendit provider for PAYMENT_RAIL=xendit", () => {
    expect(selectRail("xendit")).toBe(xenditProvider);
    expect(selectRail(' "Xendit" ')).toBe(xenditProvider);
  });
  it("returns the mock provider for PAYMENT_RAIL=mock", () => {
    expect(selectRail("mock")).toBe(mockProvider);
  });
  it("defaults to the mock provider when unset or unknown, including the retired pdax", () => {
    expect(selectRail(undefined)).toBe(mockProvider);
    expect(selectRail("nonsense")).toBe(mockProvider);
    expect(selectRail("pdax")).toBe(mockProvider);
  });
});
