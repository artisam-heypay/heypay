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
  return answer;
}

/**
 * The key out of whatever was pasted: a whole `ENCRYPTION_MASTER_KEY="…"` line
 * copied from a dashboard's raw editor is as likely as the bare value.
 */
function keyFromPaste(pasted: string): string {
  return pasted
    .trim()
    .replace(/^(export\s+)?ENCRYPTION_MASTER_KEY\s*=\s*/, "")
    .replace(/\s+#.*$/, "")
    .replace(/^(["'])(.*)\1$/, "$2")
    .replace(/\s+/g, "");
}

/** Why a pasted value is not a key, said without repeating any of it. */
function whyNotAKey(key: string): string {
  if (!key) return "Nothing was pasted.";
  if (/^\$\{\{.*\}\}$/.test(key)) {
    return "That is a reference to another variable (${{ … }}), not the key. Open the variable it points to and copy that value.";
  }
  if (/^[•*●·.]+$/.test(key)) {
    return "That is a hidden value (dots or stars). Reveal the variable first, then copy it.";
  }
  const body = key.replace(/^base64:/, "");
  const bytes = Buffer.from(body, "base64").length;
  return (
    `What was pasted is ${key.length} characters${key.startsWith("base64:") ? ', starting "base64:",' : ""} and holds ${bytes} bytes. ` +
    'A key holds exactly 32 bytes: 44 characters ending in "=", usually after "base64:".'
  );
}

async function create(): Promise<void> {
  if (getNetworkPassphrase() === Networks.PUBLIC) {
    throw new Error("create funds the account with friendbot, which is testnet-only");
  }
  if (process.argv.includes("--ask-key")) {
    const local = keyFromPaste(process.env.ENCRYPTION_MASTER_KEY ?? "");
    const key = keyFromPaste(
      await askUnseen(
        "Paste the ENCRYPTION_MASTER_KEY of the environment this is for, then press Enter (it will not show): ",
      ),
    );
    if (Buffer.from(key.replace(/^base64:/, ""), "base64").length !== 32) {
      throw new Error(`${whyNotAKey(key)} No account was created.`);
    }
    if (key.replace(/^base64:/, "") === local.replace(/^base64:/, "")) {
      throw new Error(
        "That is the same key as this machine's, so the WALLET_SPONSOR_SECRET_ENC already in .env opens there too. " +
          "No new one is needed, and no account was created. If sign-ups are still not sponsored, check that the " +
          "variable is set on both the web and the worker service and that the change was deployed.",
      );
    }
    process.env.ENCRYPTION_MASTER_KEY = key;
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
