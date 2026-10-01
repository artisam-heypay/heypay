import { describe, expect, it } from "vitest";
import { parseTemplate, parseTlv, toMap } from "@/server/qrph/tlv";

const STATIC =
  "00020101021126290010com.heypay0111HEYPAY123455204599953036085802PH5913HEYPAY COFFEE6006MANILA63043EAC";

describe("parseTlv", () => {
  it("parses top-level tags in order", () => {
    const nodes = parseTlv(STATIC);
    const map = toMap(nodes);
    expect(map["00"]).toBe("01"); // payload format
    expect(map["01"]).toBe("11"); // static
    expect(map["53"]).toBe("608"); // currency PHP
    expect(map["58"]).toBe("PH");
    expect(map["59"]).toBe("HEYPAY COFFEE");
    expect(map["63"]).toBe("3EAC"); // CRC value
  });

  it("exposes the nested merchant-account-info template (tag 26)", () => {
    const map = toMap(parseTlv(STATIC));
    const sub = parseTemplate(map["26"]!);
    expect(sub["00"]).toBe("com.heypay"); // GUI / acquirer
    expect(sub["01"]).toBe("HEYPAY12345"); // merchant id
  });

  it("throws when a declared length overruns the input", () => {
    expect(() => parseTlv("0099AB")).toThrow(/overrun|truncated|length/i);
  });

  it("throws on a non-numeric length", () => {
    expect(() => parseTlv("00XX01")).toThrow(/length/i);
  });
});
