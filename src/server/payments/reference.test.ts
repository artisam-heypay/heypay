import { describe, it, expect } from "vitest";
import { newPaymentReference } from "./reference";

describe("newPaymentReference", () => {
  it("matches TXN- + 8 RFC4648 base32 uppercase chars", () => {
    expect(newPaymentReference()).toMatch(/^TXN-[A-Z2-7]{8}$/);
  });

  it("is (practically) unique across 5000 calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(newPaymentReference());
    expect(seen.size).toBe(5000);
  });
});
