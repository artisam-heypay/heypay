// Check that the Stellar TESTNET DEX has enough USDC/XLM depth for HeyPay's path
// payments and swap page, and seed our own offers when it does not.
//
// Testnet liquidity belongs to whoever last posted an offer, so it can vanish.
// The check is the part to re-run (before a demo, after a testnet reset); the
// seeding is the fallback for a book that has gone thin.
//
// Run from the repo root:
//   node scripts/seed-dex-offers.mjs
//       Depth report. Exits 1 when 10 XLM -> USDC or 1 USDC -> XLM has no route.
//   DEX_SEED_SECRET=S... node scripts/seed-dex-offers.mjs --seed --price 8 --amount 50
//       Places a sell and a buy offer for 50 USDC around 8 XLM per USDC, from
//       the account whose secret is given. It must already hold a USDC
//       trustline, 50 USDC and enough XLM to buy 50 more.
//   DEX_SEED_SECRET=S... node scripts/seed-dex-offers.mjs --remove
//       Removes every USDC/XLM offer that account has open.
//
// USDC_ASSET_ISSUER picks the issuer; the default is Circle's testnet issuer, the
// same one the app defaults to. REFUSES to run against mainnet.
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
const USDC_ISSUER =
  process.env.USDC_ASSET_ISSUER?.trim() ||
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const TIMEOUT_SECONDS = 180;
// Our two offers sit this far either side of --price, so they never fill each other.
const SPREAD = 0.01;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
};

if (process.env.STELLAR_NETWORK === "mainnet" || HORIZON_URL.includes("horizon.stellar.org")) {
  console.error("Refusing to run against mainnet. Point STELLAR_HORIZON_URL at testnet.");
  process.exit(1);
}

const server = new Horizon.Server(HORIZON_URL);
const XLM = Asset.native();
const USDC = new Asset("USDC", USDC_ISSUER);
const label = (asset) => (asset.isNative() ? "XLM" : asset.getCode());

/** The most `amount` of `from` buys of `to` right now, with its hops; null when no route. */
async function bestRoute(from, to, amount) {
  const { records } = await server.strictSendPaths(from, amount, [to]).call();
  if (records.length === 0) return null;
  const best = records.reduce((a, b) =>
    Number(a.destination_amount) >= Number(b.destination_amount) ? a : b,
  );
  return {
    destAmount: best.destination_amount,
    hops: best.path.map((p) => p.asset_code ?? "XLM"),
  };
}

async function report() {
  const book = await server.orderbook(USDC, XLM).limit(5).call();
  console.log(`USDC:${USDC_ISSUER}`);
  console.log(`\nOrder book, USDC/XLM (price in XLM per USDC)`);
  console.log(
    `  best ask: ${book.asks[0] ? `${book.asks[0].price} (${book.asks[0].amount} USDC)` : "none"}`,
  );
  console.log(
    `  best bid: ${book.bids[0] ? `${book.bids[0].price} (${book.bids[0].amount} XLM)` : "none"}`,
  );

  // The route the acceptance check needs in each direction comes first.
  const checks = [
    [XLM, USDC, "10.0000000", true],
    [USDC, XLM, "1.0000000", true],
    [XLM, USDC, "1.0000000", false],
    [XLM, USDC, "100.0000000", false],
    [USDC, XLM, "10.0000000", false],
  ];
  let thin = false;
  console.log(`\nStrict-send routes`);
  for (const [from, to, amount, required] of checks) {
    const route = await bestRoute(from, to, amount);
    const what = `${Number(amount)} ${label(from)} -> ${label(to)}`;
    if (route) {
      const via = route.hops.length ? ` via ${route.hops.join(", ")}` : " direct";
      console.log(`  ${what}: ${route.destAmount} ${label(to)}${via}`);
    } else {
      console.log(`  ${what}: NO ROUTE${required ? " (required)" : ""}`);
      if (required) thin = true;
    }
  }
  return thin;
}

async function submit(keypair, operations) {
  const account = await server.loadAccount(keypair.publicKey());
  let builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  });
  for (const op of operations) builder = builder.addOperation(op);
  const tx = builder.setTimeout(TIMEOUT_SECONDS).build();
  tx.sign(keypair);
  const res = await server.submitTransaction(tx);
  return res.hash;
}

function seedKeypair() {
  const secret = process.env.DEX_SEED_SECRET?.trim();
  if (!secret) {
    console.error("Set DEX_SEED_SECRET to the secret key of the account that holds the offers.");
    process.exit(1);
  }
  return Keypair.fromSecret(secret);
}

async function seed() {
  const price = Number(flag("--price"));
  const amount = Number(flag("--amount") ?? "50");
  if (!(price > 0) || !(amount > 0)) {
    console.error("--seed needs --price <XLM per USDC> and a positive --amount <USDC>.");
    process.exit(1);
  }
  const keypair = seedKeypair();
  const ask = price * (1 + SPREAD);
  const bid = price * (1 - SPREAD);
  const hash = await submit(keypair, [
    // Sells USDC for XLM: the liquidity an XLM -> USDC swap takes.
    Operation.manageSellOffer({
      selling: USDC,
      buying: XLM,
      amount: amount.toFixed(7),
      price: ask.toFixed(7),
      offerId: "0",
    }),
    // Sells XLM for USDC: the liquidity a USDC -> XLM swap takes.
    Operation.manageSellOffer({
      selling: XLM,
      buying: USDC,
      amount: (amount * bid).toFixed(7),
      price: (1 / bid).toFixed(7),
      offerId: "0",
    }),
  ]);
  console.log(`Seeded from ${keypair.publicKey()}`);
  console.log(`  sells ${amount} USDC at ${ask.toFixed(7)} XLM per USDC`);
  console.log(`  buys  ${amount} USDC at ${bid.toFixed(7)} XLM per USDC`);
  console.log(`  https://stellar.expert/explorer/testnet/tx/${hash}`);
}

async function remove() {
  const keypair = seedKeypair();
  const { records } = await server.offers().forAccount(keypair.publicKey()).limit(200).call();
  const isPair = (a, b) =>
    (a.asset_type === "native" && b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER) ||
    (b.asset_type === "native" && a.asset_code === "USDC" && a.asset_issuer === USDC_ISSUER);
  const offers = records.filter((o) => isPair(o.selling, o.buying));
  if (offers.length === 0) {
    console.log(`${keypair.publicKey()} has no USDC/XLM offers open.`);
    return;
  }
  const hash = await submit(
    keypair,
    offers.map((o) =>
      Operation.manageSellOffer({
        selling: o.selling.asset_type === "native" ? XLM : USDC,
        buying: o.buying.asset_type === "native" ? XLM : USDC,
        amount: "0",
        price: o.price,
        offerId: o.id,
      }),
    ),
  );
  console.log(`Removed ${offers.length} offer(s) from ${keypair.publicKey()}`);
  console.log(`  https://stellar.expert/explorer/testnet/tx/${hash}`);
}

if (args.includes("--remove")) {
  await remove();
} else if (args.includes("--seed")) {
  await seed();
  console.log();
  await report();
} else {
  const thin = await report();
  if (thin) {
    console.error("\nThe book is too thin. Seed it: see the header of this script.");
    process.exit(1);
  }
  console.log("\nDepth is enough: both required routes exist.");
}
