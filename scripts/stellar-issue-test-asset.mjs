// Mint a test issued asset (USDT/USDC) on the Stellar TESTNET and print the env
// vars HeyPay needs to use it.
//
// Stellar testnet has no canonical USDT/USDC issuer — an issued asset is just a
// `code:issuer` pair, and anyone can create one. This script creates a fresh
// issuer account, funds it from Friendbot, and (optionally) distributes a
// starting balance to a wallet you name.
//
// Run from the repo root:
//   node scripts/stellar-issue-test-asset.mjs USDT
//   node scripts/stellar-issue-test-asset.mjs USDT --to G... --amount 500
//
// Then set in .env:
//   PAYMENT_ASSETS=XLM,USDT
//   USDT_ASSET_ISSUER=<printed issuer>
//
// REFUSES to run against mainnet: a self-issued "USDT" on the public network is
// a worthless lookalike of the real thing.
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const HORIZON_URL = process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org";
const TIMEOUT_SECONDS = 180;

const args = process.argv.slice(2);
const code = (args[0] ?? "USDT").toUpperCase();
const flag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
};
const destination = flag("--to");
const amount = flag("--amount") ?? "1000";

if (!["USDT", "USDC"].includes(code)) {
  console.error(`Unsupported asset code ${code}. Use USDT or USDC.`);
  process.exit(1);
}
if (process.env.STELLAR_NETWORK === "mainnet" || HORIZON_URL.includes("horizon.stellar.org")) {
  console.error("Refusing to issue a test asset on mainnet. Point STELLAR_HORIZON_URL at testnet.");
  process.exit(1);
}

const server = new Horizon.Server(HORIZON_URL);
const passphrase = Networks.TESTNET;

async function fundFromFriendbot(publicKey) {
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) throw new Error(`Friendbot failed for ${publicKey}: ${res.status}`);
}

async function submit(sourceKeypair, buildOps) {
  const account = await server.loadAccount(sourceKeypair.publicKey());
  let builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: passphrase,
  });
  for (const op of buildOps()) builder = builder.addOperation(op);
  const tx = builder.setTimeout(TIMEOUT_SECONDS).build();
  tx.sign(sourceKeypair);
  return server.submitTransaction(tx);
}

const issuer = Keypair.random();
console.log(`Creating ${code} issuer on testnet…`);
await fundFromFriendbot(issuer.publicKey());
const asset = new Asset(code, issuer.publicKey());

if (destination) {
  // The destination must trust the issuer before it can hold the asset, so this
  // only works for an account whose secret you control. For a HeyPay custodial
  // wallet, use the app's own "Enable USDT" button instead — the secret is
  // envelope-encrypted and never leaves the server.
  console.log(`\nTo fund ${destination}, that account must first add a trustline to:`);
  console.log(`  ${code}:${issuer.publicKey()}`);
  console.log(`Then re-run with --pay to send ${amount} ${code}.`);
  if (args.includes("--pay")) {
    await submit(issuer, () => [Operation.payment({ destination, asset, amount: String(amount) })]);
    console.log(`Sent ${amount} ${code} to ${destination}.`);
  }
}

console.log(`\n${code} issuer created.\n`);
console.log("Add to .env:");
console.log(`  PAYMENT_ASSETS=XLM,${code}`);
console.log(`  ${code}_ASSET_ISSUER=${issuer.publicKey()}`);
console.log(`  PDAX_${code}_DEPOSIT_ADDRESS=<a testnet account you control>`);
console.log(
  `  PDAX_SETTLEMENT_ASSETS=XLM,${code}   # mock rail ignores this; it trades everything`,
);
console.log(`\nIssuer secret (testnet only, keep for funding payers): ${issuer.secret()}`);
