import QRCode from "qrcode";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { decodeQrph, decodeQrphImage } from "@/server/qrph/decode";

const STATIC =
  "00020101021126290010com.heypay0111HEYPAY123455204599953036085802PH5913HEYPAY COFFEE6006MANILA63043EAC";
const DYNAMIC =
  "00020101021226290010com.heypay0111HEYPAY123455204599953036085406150.005802PH5913HEYPAY COFFEE6006MANILA6304B875";
const FOREIGN_USD =
  "00020101021126290010com.heypay0111HEYPAY123455204599953038405802PH5913HEYPAY COFFEE6006MANILA6304B266";

describe("decodeQrph", () => {
  it("decodes a valid static PH QRPH", () => {
    const d = decodeQrph(STATIC);
    expect(d.crcValid).toBe(true);
    expect(d.pointOfInit).toBe("static");
    expect(d.currency).toBe("608");
    expect(d.country).toBe("PH");
    expect(d.merchantName).toBe("HEYPAY COFFEE");
    expect(d.merchantCity).toBe("MANILA");
    expect(d.acquirerId).toBe("com.heypay");
    expect(d.merchantId).toBe("HEYPAY12345");
    expect(d.amountPhp).toBeUndefined();
  });

  it("decodes a dynamic QRPH and extracts the embedded amount", () => {
    const d = decodeQrph(DYNAMIC);
    expect(d.pointOfInit).toBe("dynamic");
    expect(d.amountPhp).toBe("150.00");
  });

  it("rejects a bad CRC", () => {
    const bad = STATIC.slice(0, -1) + "0"; // mangle last CRC char
    expect(() => decodeQrph(bad)).toThrow(/crc/i);
  });

  it("rejects a foreign currency (not 608)", () => {
    expect(() => decodeQrph(FOREIGN_USD)).toThrow(/currency/i);
  });

  it("rejects a string with no CRC tag", () => {
    expect(() => decodeQrph("0002010102")).toThrow();
  });
});

describe("decodeQrphImage", () => {
  it("reads the raw string from a rendered QR image then decodes it", async () => {
    const png = await QRCode.toBuffer(STATIC, {
      type: "png",
      errorCorrectionLevel: "M",
      width: 512,
    });
    const d = await decodeQrphImage(png);
    expect(d.merchantId).toBe("HEYPAY12345");
    expect(d.currency).toBe("608");
  }, 15_000);

  it("throws when the image contains no QR code", async () => {
    const tiny = await sharp({
      create: { width: 1, height: 1, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    await expect(decodeQrphImage(tiny)).rejects.toThrow(/qr/i);
  }, 15_000);
});
