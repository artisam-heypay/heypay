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
 *           The value only opens under the master key it was made with. To make
 *           one for another environment (the deployed site), add --ask-key: it
 *           asks for that environment's ENCRYPTION_MASTER_KEY, typed or pasted
 *           unseen, and uses it instead of this machine's.
 *   status  Prints the sponsor's address, its XLM balance, and how much of that
 *           is locked as reserve. The rest is what new wallets can still use.
 *
 * The raw secret is never printed or written to disk.
 *
 * Usage (with ENCRYPTION_MASTER_KEY, STELLAR_HORIZON_URL and, for status,
 * WALLET_SPONSOR_SECRET_ENC set):
 *   pnpm wallet:sponsor create [--ask-key]
 *   pnpm wallet:sponsor status
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
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

/** Reads one line without showing it, so a pasted key stays off the screen. */
async function askUnseen(question: string): Promise<string> {
  process.stderr.write(question);
  // On a terminal, readline echoes what is typed to `output`; this one drops it.
  const unseen = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({
    input: process.stdin,
    output: unseen,
    terminal: process.stdin.isTTY === true,
  });
  const answer = await new Promise<string>((resolve) => rl.once("line", resolve));
  rl.close();
  process.stderr.write("\n");
  return answer.trim().replace(/^(["'])(.*)\1$/, "$2");
}

async function create(): Promise<void> {
  if (getNetworkPassphrase() === Networks.PUBLIC) {
    throw new Error("create funds the account with friendbot, which is testnet-only");
  }
  if (process.argv.includes("--ask-key")) {
    process.env.ENCRYPTION_MASTER_KEY = await askUnseen(
      "Paste the ENCRYPTION_MASTER_KEY of the environment this is for, then press Enter (it will not show): ",
    );
  }
  // Fail on a missing or malformed key now, not after an account has been made
  // whose secret could then never be handed over.
  try {
    encryptSecret("check");
  } catch (err) {
    throw new Error(
      `Cannot encrypt with that master key: ${err instanceof Error ? err.message : err}. No account was created.`,
    );
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
  console.error("Usage: scripts/wallet-sponsor.ts create [--ask-key] | status");
  process.exit(1);
}
try {
  await command();
} catch (err) {
  // The message is the whole story; a stack trace only buries it.
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
process.exit(0);
