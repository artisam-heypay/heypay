import "server-only";
import jsQR from "jsqr";
import sharp from "sharp";
import { badRequest } from "@/lib/errors";
import { crc16ccitt } from "./crc";
import { parseTemplate, parseTlv, toMap } from "./tlv";

export type QrphDecoded = {
  raw: string;
  payloadFormat: string;
  pointOfInit: "static" | "dynamic";
  merchantName?: string;
  merchantCity?: string;
  merchantId?: string;
  acquirerId?: string;
  country: string;
  currency: string;
  amountPhp?: string;
  crcValid: boolean;
};

const PHP_CURRENCY = "608";

export function decodeQrph(raw: string): QrphDecoded {
  const trimmed = raw.trim();
  // CRC is always the final tag: "63" "04" + 4 hex chars (8 chars total).
  if (trimmed.length < 8 || trimmed.slice(-8, -4) !== "6304") {
    throw badRequest("QRPH is missing its CRC tag");
  }
  const provided = trimmed.slice(-4).toUpperCase();
  const computed = crc16ccitt(trimmed.slice(0, -4)); // includes "6304"
  if (provided !== computed) throw badRequest("QRPH CRC validation failed");

  let nodes;
  try {
    nodes = parseTlv(trimmed);
  } catch {
    throw badRequest("QRPH is not a valid EMVCo TLV string");
  }
  const map = toMap(nodes);

  const payloadFormat = map["00"];
  if (!payloadFormat) throw badRequest("QRPH is missing the payload format (tag 00)");

  const currency = map["53"] ?? "";
  if (currency !== PHP_CURRENCY) {
    throw badRequest("QRPH currency is not PHP (608)");
  }

  let acquirerId: string | undefined;
  let merchantId: string | undefined;
  for (const node of nodes) {
    const tagNum = Number(node.tag);
    if (tagNum >= 26 && tagNum <= 51) {
      const sub = parseTemplate(node.value);
      acquirerId ??= sub["00"];
      merchantId ??= sub["01"] ?? sub["02"] ?? sub["03"];
    }
  }

  return {
    raw: trimmed,
    payloadFormat,
    pointOfInit: map["01"] === "12" ? "dynamic" : "static",
    merchantName: map["59"],
    merchantCity: map["60"],
    merchantId,
    acquirerId,
    country: map["58"] ?? "PH",
    currency,
    amountPhp: map["54"],
    crcValid: true,
  };
}

async function readQrFromImage(image: Buffer): Promise<string | null> {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const result = jsQR(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    info.width,
    info.height,
  );
  return result?.data ?? null;
}

export async function decodeQrphImage(image: Buffer): Promise<QrphDecoded> {
  const raw = await readQrFromImage(image);
  if (!raw) throw badRequest("Could not read a QR code from the image");
  return decodeQrph(raw);
}
