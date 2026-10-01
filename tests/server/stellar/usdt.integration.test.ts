import { randomBytes } from "node:crypto";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  type xdr,
} from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { __resetKeyringForTests } from "@/server/crypto/envelope";
import { __resetHorizonForTests } from "@/server/stellar/horizon";
import { createWalletService } from "@/server/stellar/wallet";

// Exercises the real issued-asset path against live testnet: mint an asset,
// trust it, receive it, read it, spend it. Skipped in normal/CI unit runs.
const RUN = process.env.STELLAR_NETWORK === "testnet" && process.env.RUN_STELLAR_IT === "1";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const PASSPHRASE = Networks.TESTNET;

async function friendbot(publicKey: string): Promise<void> {
  const res = await fetch(`https://friendbot.stellar.org/?addr=${publicKey}`);
  if (!res.ok) throw new Error(`friendbot failed: ${res.status}`);
}

async function submit(server: Horizon.Server, source: Keypair, op: xdr.Operation): Promise<string> {
  const account = await server.loadAccount(source.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(op)
    .setTimeout(180)
    .build();
  tx.sign(source);
  const res = await server.submitTransaction(tx);
  return res.hash;
}

describe.skipIf(!RUN)("issued assets (testnet integration)", () => {
  const issuer = Keypair.random();
  let server: Horizon.Server;
  let wallet: { publicKey: string; encryptedSecret: string };

  beforeAll(async () => {
    process.env.ENCRYPTION_MASTER_KEY = `base64:${randomBytes(32).toString("base64")}`;
    process.env.ENCRYPTION_KEY_VERSION = "1";
    process.env.STELLAR_HORIZON_URL = HORIZON_URL;
    process.env.PAYMENT_ASSETS = "XLM,USDT";
    process.env.USDT_ASSET_ISSUER = issuer.publicKey();
    __resetKeyringForTests();
    __resetHorizonForTests();

    server = new Horizon.Server(HORIZON_URL);
    const svc = createWalletService();
    wallet = svc.generate();
    await Promise.all([friendbot(issuer.publicKey()), friendbot(wallet.publicKey)]);
  }, 60_000);

  it("cannot hold USDT before a trustline exists", async () => {
    const svc = createWalletService();
    const [usdt] = await svc.getBalances(wallet.publicKey, ["USDT"]);
    expect(usdt!.trustline).toBe(false);
    expect(usdt!.balance.toFixed(7)).toBe("0.0000000");
  }, 30_000);

  it("establishes a trustline, and is a no-op the second time", async () => {
    const svc = createWalletService();
    const first = await svc.establishTrustline({
      encryptedSecret: wallet.encryptedSecret,
      asset: "USDT",
    });
    expect(first.alreadyEstablished).toBe(false);
    expect(first.txHash).toBeTruthy();
    expect(await svc.confirmTx(first.txHash!)).toBe(true);

    const second = await svc.establishTrustline({
      encryptedSecret: wallet.encryptedSecret,
      asset: "USDT",
    });
    expect(second).toEqual({ txHash: null, alreadyEstablished: true });
  }, 90_000);

  it("receives USDT from the issuer and reports it as an incoming USDT payment", async () => {
    const svc = createWalletService();
    const usdt = new Asset("USDT", issuer.publicKey());
    const txHash = await submit(
      server,
      issuer,
      Operation.payment({ destination: wallet.publicKey, asset: usdt, amount: "42.5000000" }),
    );
    expect(await svc.confirmTx(txHash)).toBe(true);

    const [balance] = await svc.getBalances(wallet.publicKey, ["USDT"]);
    expect(balance!.trustline).toBe(true);
    expect(balance!.balance.toFixed(7)).toBe("42.5000000");

    const { items } = await svc.listIncomingPayments(wallet.publicKey, undefined, ["XLM", "USDT"]);
    const deposit = items.find((i) => i.txHash === txHash);
    expect(deposit).toBeDefined();
    expect(deposit!.asset).toBe("USDT");
    expect(deposit!.amount.toFixed(7)).toBe("42.5000000");
    expect(deposit!.from).toBe(issuer.publicKey());
  }, 90_000);

  it("ignores a same-code asset from a different issuer", async () => {
    // A lookalike USDT the wallet also trusts. Only the configured issuer's is
    // ours; the impostor must never be credited.
    const svc = createWalletService();
    const impostor = Keypair.random();
    await friendbot(impostor.publicKey());
    const fake = new Asset("USDT", impostor.publicKey());

    const walletKp = Keypair.fromSecret(
      (await import("@/server/crypto/envelope")).decryptSecret(wallet.encryptedSecret),
    );
    await submit(server, walletKp, Operation.changeTrust({ asset: fake }));
    const txHash = await submit(
      server,
      impostor,
      Operation.payment({ destination: wallet.publicKey, asset: fake, amount: "1000.0000000" }),
    );
    expect(await svc.confirmTx(txHash)).toBe(true);

    const { items } = await svc.listIncomingPayments(wallet.publicKey, undefined, ["XLM", "USDT"]);
    expect(items.find((i) => i.txHash === txHash)).toBeUndefined();

    // ...and the real USDT balance is untouched by the impostor's 1000.
    const [balance] = await svc.getBalances(wallet.publicKey, ["USDT"]);
    expect(balance!.balance.toFixed(7)).toBe("42.5000000");
  }, 120_000);

  it("trusts the real testnet USDC and USDT issuers resolved from config defaults", async () => {
    // No *_ASSET_ISSUER set: testnet falls back to Circle's Centre issuer, which
    // issues both codes there. Proves a fresh dev machine can trust and hold
    // real testnet USDC/USDT with no extra configuration.
    delete process.env.USDT_ASSET_ISSUER;
    delete process.env.USDC_ASSET_ISSUER;
    const svc = createWalletService();
    const fresh = svc.generate();
    await friendbot(fresh.publicKey);

    for (const asset of ["USDC", "USDT"] as const) {
      const before = await svc.getBalances(fresh.publicKey, [asset]);
      expect(before[0]!.trustline).toBe(false);

      const res = await svc.establishTrustline({
        encryptedSecret: fresh.encryptedSecret,
        asset,
      });
      expect(await svc.confirmTx(res.txHash!)).toBe(true);

      const after = await svc.getBalances(fresh.publicKey, [asset]);
      expect(after[0]!.trustline).toBe(true);
      expect(after[0]!.balance.toFixed(7)).toBe("0.0000000");
    }

    process.env.USDT_ASSET_ISSUER = issuer.publicKey();
  }, 120_000);

  it("sends USDT back out (the settlement leg)", async () => {
    const svc = createWalletService();
    const { txHash } = await svc.sendAsset({
      encryptedSecret: wallet.encryptedSecret,
      destination: issuer.publicKey(),
      asset: "USDT",
      amount: (await import("@/lib/money")).dec("2.5"),
      memo: "TXN-TEST",
    });
    expect(await svc.confirmTx(txHash)).toBe(true);

    const [balance] = await svc.getBalances(wallet.publicKey, ["USDT"]);
    expect(balance!.balance.toFixed(7)).toBe("40.0000000");
  }, 90_000);
});
