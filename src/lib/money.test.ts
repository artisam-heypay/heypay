import { describe, it, expect } from "vitest";
import {
  dec,
  formatXlm,
  formatPhp,
  displayPhp,
  displayXlm,
  phpToXlm,
  availableXlm,
  Decimal,
} from "./money";

describe("dec", () => {
  it("constructs from string, number, and Decimal", () => {
    expect(dec("1.5").toString()).toBe("1.5");
    expect(dec(2).toString()).toBe("2");
    expect(dec(new Decimal("3")).toString()).toBe("3");
  });
  it("throws on NaN and Infinity", () => {
    expect(() => dec(NaN)).toThrow();
    expect(() => dec(Infinity)).toThrow();
  });
});

describe("formatXlm", () => {
  it("always renders exactly 7 decimal places", () => {
    expect(formatXlm(dec("12.5"))).toBe("12.5000000");
    expect(formatXlm(dec("0"))).toBe("0.0000000");
  });
  it("rounds half-up at the 7th decimal", () => {
    expect(formatXlm(dec("1.00000005"))).toBe("1.0000001");
  });
});

describe("formatPhp", () => {
  it("always renders exactly 2 decimal places, half-up", () => {
    expect(formatPhp(dec("1234.5"))).toBe("1234.50");
    expect(formatPhp(dec("1.005"))).toBe("1.01");
  });
});

describe("displayPhp / displayXlm", () => {
  it("groups thousands with the peso sign at 2dp", () => {
    expect(displayPhp(dec("1234.5"))).toBe("₱1,234.50");
    expect(displayPhp(dec("1000000"))).toBe("₱1,000,000.00");
  });
  it("suffixes XLM with the unit at 7dp", () => {
    expect(displayXlm(dec("12.5"))).toBe("12.5000000 XLM");
  });
});

describe("phpToXlm", () => {
  it("rounds UP at 7dp so the payer always covers the PHP amount", () => {
    expect(phpToXlm(dec("100"), dec("7")).toString()).toBe("14.2857143");
    expect(phpToXlm(dec("1"), dec("3")).toString()).toBe("0.3333334");
  });
  it("throws on a non-positive rate", () => {
    expect(() => phpToXlm(dec("1"), dec("0"))).toThrow();
  });
});

describe("availableXlm", () => {
  it("subtracts reserved from cached", () => {
    expect(availableXlm(dec("10"), dec("3.5")).toString()).toBe("6.5");
  });
});
