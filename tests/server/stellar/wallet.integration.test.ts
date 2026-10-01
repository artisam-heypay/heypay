import { randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { __resetKeyringForTests } from "@/server/crypto/envelope";
import { __resetHorizonForTests } from "@/server/stellar/horizon";
import { createWalletService } from "@/server/stellar/wallet";

// Only runs against live testnet + friendbot. Skipped in normal/CI unit runs.
const RUN = process.env.STELLAR_NETWORK === "testnet" && process.env.RUN_STELLAR_IT === "1";

describe.skipIf(!RUN)("WalletService (testnet integration)", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_MASTER_KEY = `base64:${randomBytes(32).toString("base64")}`;
    process.env.ENCRYPTION_KEY_VERSION = "1";
    process.env.STELLAR_HORIZON_URL = "https://horizon-testnet.stellar.org";
    __resetKeyringForTests();
    __resetHorizonForTests();
  });

  it("funds a new account via friendbot and reads a positive balance", async () => {
    const svc = createWalletService();
    const kp = Keypair.random();
    const res = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
    expect(res.ok).toBe(true);
    const bal = await svc.getBalance(kp.publicKey());
    expect(bal.greaterThan(0)).toBe(true);
  }, 30_000);
});
