#!/usr/bin/env tsx
/**
 * Generates static QRPH test codes (EMVCo, PHP 608, valid CRC) as PNG images
 * for alpha testers: one shared test shop that payers pay, and one unique code
 * per interview tester to link their own practice shop in onboarding.
 *
 * Each code carries its own merchant id (tag 28 / sub-tag 01), because the app
 * resolves a scanned code to a merchant by its exact text or that id, and
 * refuses a code already linked to another merchant.
 *
 * These are synthetic codes. No bank or e-wallet will accept them; they only
 * work inside HeyPay.
 *
 * Usage:
 *   pnpm exec tsx scripts/make-test-qrph.ts <out-dir> [tester-count] [id-prefix]
 *   pnpm exec tsx scripts/make-test-qrph.ts docs/testing-guides/week-1/qr 5 W1
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";

/** CRC-16/CCITT-FALSE, as QRPH (EMVCo) tag 63 requires. */
function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function tlv(tag: string, value: string): string {
  return `${tag}${String(value.length).padStart(2, "0")}${value}`;
}

/** A static QRPH P2M payload for `merchantId`, named `name` in `city`. */
export function qrphPayload(merchantId: string, name: string, city: string): string {
  const body =
    tlv("00", "01") + // payload format
    tlv("01", "11") + // static
    tlv("28", tlv("00", "com.p2pqrpay") + tlv("01", merchantId)) +
    tlv("52", "5499") + // misc. food stores (sari-sari)
    tlv("53", "608") + // PHP
    tlv("58", "PH") +
    tlv("59", name.slice(0, 25)) +
    tlv("60", city.slice(0, 15)) +
    "6304";
  return body + crc16(body);
}

async function writeCode(dir: string, file: string, payload: string): Promise<void> {
  const png = await QRCode.toBuffer(payload, { errorCorrectionLevel: "M", margin: 4, width: 640 });
  writeFileSync(join(dir, file), png);
  console.log(`${file}\t${payload}`);
}

async function main(): Promise<void> {
  const [outDir, countArg = "5", prefix = "W1"] = process.argv.slice(2);
  if (!outDir) throw new Error("usage: make-test-qrph.ts <out-dir> [tester-count] [id-prefix]");
  const count = Number(countArg);
  if (!Number.isInteger(count) || count < 0) throw new Error(`bad tester count: ${countArg}`);
  mkdirSync(outDir, { recursive: true });

  await writeCode(
    outDir,
    "heypay-test-shop.png",
    qrphPayload(`HPTEST-${prefix}-SHOP`, "HEYPAY TEST SHOP", "MAKATI"),
  );
  for (let i = 1; i <= count; i++) {
    const n = String(i).padStart(2, "0");
    await writeCode(
      outDir,
      `your-shop-qrph-${n}.png`,
      qrphPayload(`HPTEST-${prefix}-T${n}`, `PRACTICE SHOP ${n}`, "MANILA"),
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
