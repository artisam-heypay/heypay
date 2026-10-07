import { randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { dec } from "@/lib/money";
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

  it("activates a new wallet on a sponsor's reserve, leaving it no XLM of its own", async () => {
    const svc = createWalletService();
    const sponsor = svc.generate();
    const wallet = svc.generate();
    const res = await fetch(`https://friendbot.stellar.org/?addr=${sponsor.publicKey}`);
    expect(res.ok).toBe(true);
    const activation = {
      sponsorEncryptedSecret: sponsor.encryptedSecret,
      encryptedSecret: wallet.encryptedSecret,
      assets: ["USDC"] as const,
    };

    const first = await svc.activateSponsored(activation);
    expect(first).toMatchObject({ created: true, trustlines: ["USDC"] });
    const [xlm, usdc] = await svc.getBalances(wallet.publicKey, ["XLM", "USDC"]);
    expect(xlm!.balance.isZero()).toBe(true);
    expect(usdc!.trustline).toBe(true);
    // The reserve is locked in the sponsor's balance, not the wallet's, and
    // the empty creation is not a deposit.
    expect((await svc.lockedXlm(wallet.publicKey)).isZero()).toBe(true);
    expect((await svc.listIncomingPayments(wallet.publicKey)).items).toEqual([]);

    // With 1 XLM of its own the wallet can spend that and nothing beyond it.
    const pay = (from: string, to: string, amount: string) =>
      svc.sendXlm({ encryptedSecret: from, destination: to, amountXlm: dec(amount), memo: "it" });
    await pay(sponsor.encryptedSecret, wallet.publicKey, "1");
    await expect(pay(wallet.encryptedSecret, sponsor.publicKey, "1.2")).rejects.toThrow(
      /op_underfunded/,
    );
    await pay(wallet.encryptedSecret, sponsor.publicKey, "0.9");

    expect(await svc.activateSponsored(activation)).toEqual({
      txHash: null,
      created: false,
      trustlines: [],
    });
  }, 120_000);
});
