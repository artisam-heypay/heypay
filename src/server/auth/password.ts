import "server-only";
import argon2 from "argon2";

// OWASP Password Storage Cheat Sheet (argon2id): m=19456 KiB (19 MiB), t=2, p=1.
const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Malformed hash or verifier error — treat as a failed verification, never throw.
    return false;
  }
}

// Precomputed argon2id hash of a random value no one knows. Used by the login path
// to run a verify() even when the username is unknown, equalizing response timing
// so attackers cannot enumerate accounts from latency.
export const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c29tZS1zdGF0aWMtc2FsdC1ieXRlcw$3b3v2yq9o0Yk0m3hQk0o2k1m0n5q7r8s9t0u1v2w3x4";
