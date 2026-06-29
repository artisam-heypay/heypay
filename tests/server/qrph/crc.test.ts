import { describe, expect, it } from "vitest";
import { crc16ccitt } from "@/server/qrph/crc";

describe("crc16ccitt", () => {
  it("matches the canonical CRC-16/CCITT-FALSE check value", () => {
    // "123456789" -> 0x29B1 is the published check value for this CRC variant.
    expect(crc16ccitt("123456789")).toBe("29B1");
  });

  it("matches the CRC for a real PH static QRPH body (ending in 6304)", () => {
    const body =
      "00020101021126290010com.heypay0111HEYPAY123455204599953036085802PH5913HEYPAY COFFEE6006MANILA6304";
    expect(crc16ccitt(body)).toBe("3EAC");
  });

  it("detects a one-character change", () => {
    expect(crc16ccitt("123456789")).not.toBe(crc16ccitt("12345678X"));
  });
});
