// src/server/payments/reference.ts
import "server-only";
import { randomBytes } from "node:crypto";

// RFC 4648 base32 alphabet (no padding), uppercase.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newPaymentReference(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i]! % 32];
  return `TXN-${out}`;
}
