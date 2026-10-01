import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetKeyringForTests, decryptSecret, encryptSecret } from "@/server/crypto/envelope";

const KEY_B64 = randomBytes(32).toString("base64");

beforeEach(() => {
  process.env.ENCRYPTION_MASTER_KEY = `base64:${KEY_B64}`;
  process.env.ENCRYPTION_KEY_VERSION = "1";
  delete process.env.ENCRYPTION_MASTER_KEY_V2;
  __resetKeyringForTests();
});

describe("envelope encryption", () => {
  it("round-trips a secret", () => {
    const secret = "SCDV3...test-stellar-secret";
    const enc = encryptSecret(secret);
    expect(enc).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("uses a distinct IV per call (ciphertext differs)", () => {
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    expect(a).not.toBe(b);
    expect(a.split(":")[1]).not.toBe(b.split(":")[1]); // iv segment
  });

  it("throws on a tampered auth tag", () => {
    const enc = encryptSecret("secret");
    const [v, iv, tag, ct] = enc.split(":") as [string, string, string, string];
    const badTag = Buffer.from(tag, "base64");
    badTag[0]! ^= 0xff;
    const tampered = [v, iv, badTag.toString("base64"), ct].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("throws on a malformed payload", () => {
    expect(() => decryptSecret("not-a-valid-payload")).toThrow(/format/i);
  });

  it("throws when no key exists for the payload version", () => {
    const enc = encryptSecret("secret");
    const v9 = enc.replace(/^v1:/, "v9:");
    expect(() => decryptSecret(v9)).toThrow(/version 9/);
  });

  it("decrypts a legacy version using a historical key (rotation)", () => {
    // Encrypt under v1, then rotate: v2 becomes current, v1 retained as historical.
    const legacy = encryptSecret("rotated-secret");
    process.env.ENCRYPTION_MASTER_KEY_V2 = `base64:${randomBytes(32).toString("base64")}`;
    process.env.ENCRYPTION_MASTER_KEY = process.env.ENCRYPTION_MASTER_KEY_V2;
    process.env.ENCRYPTION_KEY_VERSION = "2";
    process.env.ENCRYPTION_MASTER_KEY_V1 = `base64:${KEY_B64}`;
    __resetKeyringForTests();
    expect(encryptSecret("x")).toMatch(/^v2:/);
    expect(decryptSecret(legacy)).toBe("rotated-secret");
  });
});
