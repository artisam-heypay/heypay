import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, DUMMY_PASSWORD_HASH } from "@/server/auth/password";

describe("password", () => {
  it("hashes then verifies the same password (round-trip)", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("correct horse"); // plaintext never embedded
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("right-password");
    expect(await verifyPassword(hash, "wrong-password")).toBe(false);
  });

  it("returns false (does not throw) for a malformed hash", async () => {
    expect(await verifyPassword("not-a-real-hash", "anything")).toBe(false);
  });

  it("ships a valid dummy hash for timing equalization", async () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(DUMMY_PASSWORD_HASH, "literally anything")).toBe(false);
  });
});
