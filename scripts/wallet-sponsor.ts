#!/usr/bin/env tsx
/**
 * Manages the account that sponsors new payer wallets
 * (src/server/queue/jobs/wallet-activate.ts). It pays the network reserve of
 * each new wallet's account and trustlines: 1.5 XLM a wallet with USDC on,
 * locked in the sponsor's own balance for as long as the wallet exists.
 *
 *   create  Testnet only. New keypair, funded by friendbot (10,000 XLM). Prints
 *           the public key and the envelope-encrypted WALLET_SPONSOR_SECRET_ENC
 *           to paste into the env of the web and the worker service.
 *   status  Prints the sponsor's address, its XLM balance, and how much of that
 *           is locked as reserve. The rest is what new wallets can still use.
 *
 * The raw secret is never printed or written to disk.
 *
 * Usage (with ENCRYPTION_MASTER_KEY, STELLAR_HORIZON_URL and, for status,
 * WALLET_SPONSOR_SECRET_ENC set):
 *   pnpm wallet:sponsor create|status
 */
import "dotenv/config";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { decryptSecret, encryptSecret } from "@/server/crypto/envelope";
import { getNetworkPassphrase } from "@/server/stellar/horizon";
import { walletService } from "@/server/stellar/wallet";

const FRIENDBOT_URL = "https://friendbot.stellar.org";

async function report(publicKey: string): Promise<void> {
  const balance = await walletService.getBalance(publicKey);
  const locked = await walletService.lockedXlm(publicKey);
  console.log(`Sponsor account: ${publicKey}`);
  console.log(`Balance: ${balance.toFixed(7)} XLM`);
  console.log(`Locked as reserve: ${locked.toFixed(7)} XLM`);
  console.log(`Free for new wallets: ${balance.minus(locked).toFixed(7)} XLM`);
}

async function create(): Promise<void> {
  if (getNetworkPassphrase() === Networks.PUBLIC) {
    throw new Error("create funds the account with friendbot, which is testnet-only");
  }
  const kp = Keypair.random();
  const res = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(kp.publicKey())}`);
  if (!res.ok) throw new Error(`friendbot ${res.status}: ${await res.text()}`);
  await report(kp.publicKey());
  console.log("\nAdd to the environment of the web and the worker service:");
  console.log(`WALLET_SPONSOR_SECRET_ENC=${encryptSecret(kp.secret())}`);
}

async function status(): Promise<void> {
  const enc = process.env.WALLET_SPONSOR_SECRET_ENC?.trim();
  if (!enc) throw new Error("WALLET_SPONSOR_SECRET_ENC is not set");
  await report(Keypair.fromSecret(decryptSecret(enc)).publicKey());
}

const commands: Record<string, () => Promise<void>> = { create, status };
const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.error("Usage: scripts/wallet-sponsor.ts create|status");
  process.exit(1);
}
await command();
process.exit(0);
