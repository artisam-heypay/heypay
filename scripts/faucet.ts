#!/usr/bin/env tsx
/**
 * Manages the testnet faucet account behind the dashboard's "Claim test XLM"
 * button (src/server/payer/faucet.ts). Testnet only.
 *
 *   create  New keypair, funded by friendbot (10,000 XLM). Prints the public key
 *           and the envelope-encrypted FAUCET_SECRET_ENC to paste into the env.
 *   topup   Friendbot only funds brand-new accounts, so this funds a throwaway
 *           one and merges it into the faucet (+~10,000 XLM each run).
 *   status  Prints the faucet's address and XLM balance.
 *
 * The raw secret is never printed or written to disk.
 *
 * Usage (with ENCRYPTION_MASTER_KEY, STELLAR_HORIZON_URL and, for topup/status,
 * FAUCET_SECRET_ENC set):
 *   node --conditions=react-server --import tsx scripts/faucet.ts create|topup|status
 */
import "dotenv/config";
import { Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { decryptSecret, encryptSecret } from "@/server/crypto/envelope";
import { getHorizon, getNetworkPassphrase } from "@/server/stellar/horizon";
import { walletService } from "@/server/stellar/wallet";

const FRIENDBOT_URL = "https://friendbot.stellar.org";

async function friendbot(publicKey: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT_URL}/?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) throw new Error(`friendbot ${res.status} for ${publicKey}: ${await res.text()}`);
}

function faucetKeypair(): Keypair {
  const enc = process.env.FAUCET_SECRET_ENC?.trim();
  if (!enc) throw new Error("FAUCET_SECRET_ENC is not set");
  return Keypair.fromSecret(decryptSecret(enc));
}

async function create(): Promise<void> {
  const kp = Keypair.random();
  await friendbot(kp.publicKey());
  console.log(`Faucet account: ${kp.publicKey()}`);
  console.log(`Balance: ${(await walletService.getBalance(kp.publicKey())).toFixed(7)} XLM`);
  console.log("\nAdd to the environment:");
  console.log(`FAUCET_SECRET_ENC=${encryptSecret(kp.secret())}`);
}

async function topup(): Promise<void> {
  const faucet = faucetKeypair();
  const temp = Keypair.random();
  await friendbot(temp.publicKey());
  const server = getHorizon();
  const account = await server.loadAccount(temp.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: String(await server.fetchBaseFee()),
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(Operation.accountMerge({ destination: faucet.publicKey() }))
    .setTimeout(180)
    .build();
  tx.sign(temp);
  await server.submitTransaction(tx);
  await status();
}

async function status(): Promise<void> {
  const publicKey = faucetKeypair().publicKey();
  console.log(`Faucet account: ${publicKey}`);
  console.log(`Balance: ${(await walletService.getBalance(publicKey)).toFixed(7)} XLM`);
}

const commands: Record<string, () => Promise<void>> = { create, topup, status };
const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.error("Usage: scripts/faucet.ts create|topup|status");
  process.exit(1);
}
if (getNetworkPassphrase() === Networks.PUBLIC) {
  console.error("The faucet is testnet-only; STELLAR_NETWORK is mainnet.");
  process.exit(1);
}
await command();
process.exit(0);
