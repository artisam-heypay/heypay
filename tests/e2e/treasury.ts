// tests/e2e/treasury.ts
//
// A throwaway testnet account that stands in for the HeyPay treasury. Even with
// PAYMENT_RAIL=mock the settlement's Stellar leg is real (SPEC §8.2): the payer's
// XLM lands here, and a refund is signed and sent from here, so the app needs its
// secret too. globalSetup friendbot-funds it.
import { createCipheriv, randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

/**
 * This run's treasury. Made once in the runner process and kept in its
 * environment, so the web server, the worker and globalSetup all see the same one.
 */
export function e2eTreasury(): Keypair {
  process.env.E2E_TREASURY_SECRET ??= Keypair.random().secret();
  return Keypair.fromSecret(process.env.E2E_TREASURY_SECRET);
}

/**
 * Envelope-encrypts `plaintext` the way src/server/crypto/envelope.ts does
 * (`v<version>:iv:tag:ciphertext`, AES-256-GCM). That module is server-only, so
 * the Playwright config cannot import it.
 */
export function encryptForApp(plaintext: string, masterKey: string, version = "1"): string {
  const key = Buffer.from(masterKey.replace(/^base64:/, ""), "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    `v${version}`,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}
