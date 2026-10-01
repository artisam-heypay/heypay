import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length

type Keyring = { current: number; keys: Map<number, Buffer> };
let cached: Keyring | null = null;

function decodeKey(raw: string): Buffer {
  const b64 = raw.startsWith("base64:") ? raw.slice("base64:".length) : raw;
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_MASTER_KEY must decode to exactly 32 bytes (AES-256)");
  }
  return key;
}

function loadKeyring(): Keyring {
  if (cached) return cached;
  const master = process.env.ENCRYPTION_MASTER_KEY;
  if (!master) throw new Error("ENCRYPTION_MASTER_KEY is not set");
  const current = Number(process.env.ENCRYPTION_KEY_VERSION ?? "1");
  if (!Number.isInteger(current) || current < 1) {
    throw new Error("ENCRYPTION_KEY_VERSION must be a positive integer");
  }
  const keys = new Map<number, Buffer>();
  keys.set(current, decodeKey(master));
  for (const [name, value] of Object.entries(process.env)) {
    const m = /^ENCRYPTION_MASTER_KEY_V(\d+)$/.exec(name);
    if (m && value) keys.set(Number(m[1]), decodeKey(value));
  }
  cached = { current, keys };
  return cached;
}

export function __resetKeyringForTests(): void {
  cached = null;
}

export function encryptSecret(plaintext: string): string {
  const { current, keys } = loadKeyring();
  const key = keys.get(current);
  if (!key) throw new Error(`No key available for version ${current}`);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${current}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString(
    "base64",
  )}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || !/^v\d+$/.test(parts[0]!)) {
    throw new Error("Invalid ciphertext format");
  }
  const version = Number(parts[0]!.slice(1));
  const { keys } = loadKeyring();
  const key = keys.get(version);
  if (!key) throw new Error(`No key available for version ${version}`);
  const iv = Buffer.from(parts[1]!, "base64");
  const tag = Buffer.from(parts[2]!, "base64");
  const ciphertext = Buffer.from(parts[3]!, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
