// Writes the on-chain receipt list (docs/validation/receipts.md) from
// docs/validation/receipts.json, after checking every entry on Stellar Testnet.
//
// The JSON names each transaction and what it should prove. Everything else in
// the list is read from the chain: the call and contract a transaction made,
// the amount, the job id, the date and who signed it. A transaction that is
// missing, failed, made a different call, or was not signed by the account the
// JSON names stops the run, and the list is not written. Each escrow contract's
// code is fetched and its sha256 compared with the published WASM.
//
// Run from the repo root:
//   node scripts/receipts.mjs           check everything, then write the list
//   node scripts/receipts.mjs --check   check everything, write nothing
//
// STELLAR_HORIZON_URL and SOROBAN_RPC_URL pick the servers; the defaults are
// SDF's Testnet ones. REFUSES any network but Testnet.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import * as prettier from "prettier";
import {
  FeeBumpTransaction,
  Keypair,
  Networks,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

const SOURCE = "docs/validation/receipts.json";
const OUTPUT = "docs/validation/receipts.md";
const HORIZON_URL = process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
const RPC_URL = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const EXPERT = "https://stellar.expert/explorer/testnet";
const TREASURY = "GDZ2BQPZQLLXTBFVKJX6UVZQAIZCIC4HDGT4XDLH5JOWO7WWP2KLIN37";
const STROOPS = 10_000_000n;
const CONTRACT_CALLS = new Set([
  "initialize",
  "deposit",
  "release",
  "refund",
  "refund_after_timeout",
  "set_timeout",
]);
const REFUND_CALLS = new Set(["refund", "refund_after_timeout"]);

const checkOnly = process.argv.includes("--check");

const short = (s) => `${s.slice(0, 8)}…`;
const shortAccount = (g) => `${g.slice(0, 4)}…${g.slice(-4)}`;
const txLink = (hash) => `[\`${short(hash)}\`](${EXPERT}/tx/${hash})`;
const contractLink = (id) => `[\`${shortAccount(id)}\`](${EXPERT}/contract/${id})`;

/** Stroops as token units, without trailing zeros: 7228668n → "0.7228668". */
function units(stroops) {
  const whole = stroops / STROOPS;
  const frac = (stroops % STROOPS).toString().padStart(7, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** "2026-10-15T11:24:32Z" → "2026-10-15 11:24". */
const when = (iso) => iso.slice(0, 16).replace("T", " ");

async function horizon(path) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${HORIZON_URL}${path}`);
    if (res.ok) return res.json();
    if (res.status === 404) return null;
    // Rate-limited or busy: wait and ask again a few times.
    if (attempt === 4) throw new Error(`Horizon ${path} answered ${res.status}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
}

/** Runs `fn` over `items` a few at a time, keeping the order. */
async function mapLimited(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/** Whether `account`'s key made one of the transaction's signatures. */
function signedBy(envelopeXdr, account) {
  const tx = TransactionBuilder.fromXDR(envelopeXdr, Networks.TESTNET);
  const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
  const key = Keypair.fromPublicKey(account);
  const hash = inner.hash();
  return inner.signatures.some((s) => {
    try {
      return key.verify(hash, s.signature());
    } catch {
      return false;
    }
  });
}

/** What one transaction did, read from Horizon, or the reason it does not prove `entry`. */
async function readReceipt(entry) {
  const tx = await horizon(`/transactions/${entry.tx}`);
  if (!tx) return { problem: "not found on Testnet" };
  if (!tx.successful) return { problem: "did not succeed" };
  const ops = (await horizon(`/transactions/${entry.tx}/operations?limit=10`))._embedded.records;
  // A contract call is always alone in its transaction. A classic operation can
  // ride with others, such as a trustline set up inside a sponsored sign-up.
  const op = CONTRACT_CALLS.has(entry.call) ? ops[0] : ops.find((o) => o.type === entry.call);
  if (CONTRACT_CALLS.has(entry.call) && ops.length !== 1) {
    return { problem: `has ${ops.length} operations, expected 1` };
  }
  if (!op) return { problem: `has no ${entry.call} operation` };

  const found = {
    date: tx.created_at,
    ledger: tx.ledger,
    source: tx.source_account,
    fee: tx.fee_charged,
  };

  if (entry.signer) {
    if (tx.source_account !== entry.signer) {
      return { problem: `source is ${tx.source_account}, expected ${entry.signer}` };
    }
    if (!signedBy(tx.envelope_xdr, entry.signer)) {
      return { problem: `not signed by ${entry.signer}` };
    }
    if (signedBy(tx.envelope_xdr, TREASURY)) return { problem: "also signed by the treasury" };
    found.signerChecked = true;
  }

  if (CONTRACT_CALLS.has(entry.call)) {
    if (op.type !== "invoke_host_function" || !op.parameters) {
      return { problem: `is a ${op.type}, not a contract call` };
    }
    const [contract, fn, ...args] = op.parameters.map((p) =>
      scValToNative(xdr.ScVal.fromXDR(p.value, "base64")),
    );
    if (contract !== entry.contract) return { problem: `called ${contract}` };
    if (fn !== entry.call) return { problem: `called ${fn}, expected ${entry.call}` };
    if (fn === "set_timeout") found.detail = `${args[0]} ledgers`;
    if (fn === "initialize") found.detail = `admin ${shortAccount(args[0])}`;
    if (["deposit", "release", "refund", "refund_after_timeout"].includes(fn)) {
      found.jobId = Buffer.from(args[0]).toString("hex");
    }
    if (fn === "deposit") {
      found.from = args[1];
      found.stroops = BigInt(args[2]);
    }
    // The escrow pays out through the token's own transfer; its amount is the
    // amount the job held.
    const moved = (op.asset_balance_changes ?? []).find((c) => c.type === "transfer");
    if (moved && !found.stroops) found.amount = moved.amount;
    if (moved && fn !== "deposit") found.to = moved.to;
    return found;
  }

  if (op.type !== entry.call) return { problem: `is a ${op.type}, expected ${entry.call}` };
  if (op.type === "change_trust") {
    found.detail = `trusts ${op.asset_code} from ${shortAccount(op.asset_issuer)}`;
  } else {
    const code = (type, c) => (type === "native" ? "XLM" : c);
    found.detail =
      `${op.source_amount} ${code(op.source_asset_type, op.source_asset_code)} → ` +
      `${op.amount} ${code(op.asset_type, op.asset_code)}`;
    found.direction = `${code(op.source_asset_type, op.source_asset_code)}>${code(op.asset_type, op.asset_code)}`;
  }
  return found;
}

/** Whether the contract runs the published WASM, and its deploy and initialize transactions. */
async function readContract(contract, wasmHash, server) {
  const problems = [];
  let wasmMatches = false;
  try {
    const wasm = await server.getContractWasmByContractId(contract.id);
    wasmMatches = createHash("sha256").update(wasm).digest("hex") === wasmHash;
    if (!wasmMatches) problems.push("its code is not the published WASM");
  } catch (err) {
    problems.push(`its code could not be read: ${err.message ?? err}`);
  }
  const txs = {};
  for (const [key, call] of [
    ["deployTx", "deploy"],
    ["initTx", "initialize"],
  ]) {
    if (!contract[key]) continue;
    if (call === "deploy") {
      const tx = await horizon(`/transactions/${contract[key]}`);
      const ops = tx && (await horizon(`/transactions/${contract[key]}/operations`));
      const fn = ops?._embedded.records[0]?.function ?? "";
      if (!tx?.successful || !/CreateContract/.test(fn)) {
        problems.push(`deploy tx ${short(contract[key])} is not a successful contract creation`);
      } else {
        txs[key] = tx.created_at;
      }
    } else {
      const r = await readReceipt({ tx: contract[key], call, contract: contract.id });
      if (r.problem) problems.push(`initialize tx ${short(contract[key])} ${r.problem}`);
      else txs[key] = r.date;
    }
  }
  return { problems, wasmMatches, txs };
}

function signerLabel(account, accounts) {
  const name = accounts[account];
  return name ? `${name} (${shortAccount(account)})` : shortAccount(account);
}

function render(data, contracts, sections, checkedAt) {
  const contractById = Object.fromEntries(data.contracts.map((c) => [c.id, c]));
  const assetOf = (id) => contractById[id]?.asset ?? "";
  // A job's amount is set once, at deposit; release and refund rows reuse it.
  const depositedBy = new Map();
  for (const s of sections) {
    for (const r of s.rows) if (r.found.stroops) depositedBy.set(r.found.jobId, r.found.stroops);
  }

  const lines = [];
  const all = sections.flatMap((s) => s.rows);
  const appIds = new Set(data.contracts.filter((c) => c.app).map((c) => c.id));
  const count = (pred) => all.filter(pred).length;
  const releases = count((r) => r.entry.call === "release" && appIds.has(r.entry.contract));
  const refunds = count((r) => REFUND_CALLS.has(r.entry.call));
  const timeoutRefunds = count((r) => r.entry.call === "refund_after_timeout");
  const usdcId = data.contracts.find((c) => c.app && c.asset === "USDC")?.id;
  const usdcCalls = new Set(
    all.filter((r) => r.entry.contract === usdcId).map((r) => r.entry.call),
  );
  const trustlines = count((r) => r.entry.call === "change_trust");
  const freighterPayments = count(
    (r) => r.entry.call === "deposit" && r.found.signerChecked && appIds.has(r.entry.contract),
  );
  const swaps = new Set(all.map((r) => r.found.direction).filter(Boolean));
  const ok = (b) => (b ? "Met" : "**Not met**");

  lines.push(
    "# On-chain receipt list (Stellar Testnet)",
    "",
    "<!-- Generated by `node scripts/receipts.mjs` from receipts.json. Edit the JSON, not this file. -->",
    "",
    "Each on-chain claim of HeyPay's Instawards sprint, with the Testnet transaction",
    "that proves it. Click any link to open the transaction on Stellar Expert, the",
    "public Stellar explorer: no account or login is needed.",
    "",
    `Checked against Stellar Testnet on ${checkedAt}. For every transaction below,`,
    "the script confirmed on the chain that it succeeded and that it made the call",
    "named, on the contract named. Amounts, dates and signers are read from the",
    "chain, not typed in. Where a row says the payer's own key signed, the script",
    "checked the signature against the payer's key, and checked that the HeyPay",
    "treasury key did not sign.",
    "",
    "## SOW targets",
    "",
    "| Target | Found below | Status |",
    "| ------ | ----------- | ------ |",
    `| 1 escrow contract deployed with a published contract ID | ${appIds.size} app escrows (XLM and USDC), each running the published WASM | ${ok(contracts.filter((c) => c.contract.app && c.wasmMatches).length >= 1)} |`,
    `| At least 3 escrow-routed settlements | ${releases} releases from the app escrows | ${ok(releases >= 3)} |`,
    `| At least 2 on-chain refunds, one a payer-called \`refund_after_timeout()\` | ${refunds} refunds, ${timeoutRefunds} of them \`refund_after_timeout\` | ${ok(refunds >= 2 && timeoutRefunds >= 1)} |`,
    `| USDC live end to end | ${trustlines} USDC trustlines; USDC escrow ${["deposit", "release", "refund"].filter((c) => usdcCalls.has(c)).join(", ")} | ${ok(trustlines > 0 && ["deposit", "release", "refund"].every((c) => usdcCalls.has(c)))} |`,
    `| At least 1 non-custodial Freighter payment | ${freighterPayments} deposits into the app escrow signed by the payer's own key | ${ok(freighterPayments >= 1)} |`,
    `| Both swap directions (XLM↔USDC) | ${[...swaps].map((d) => d.replace(">", " → ")).join(", ")} | ${ok(swaps.has("XLM>USDC") && swaps.has("USDC>XLM"))} |`,
    "",
    "## How to check a receipt yourself",
    "",
    "1. Click the transaction link. Stellar Expert opens the transaction.",
    '2. The page says whether it succeeded, when, and which account sent it ("source account").',
    "3. Under operations, a contract call shows the contract and the function, such as",
    "   `deposit` or `refund`. A deposit's arguments include the amount in stroops",
    "   (1 XLM or 1 USDC is 10,000,000 stroops).",
    "4. The token transfer shows the money moving: into the escrow contract on a",
    "   deposit, out of it on a release or a refund.",
    "",
    "Rows with the same job id are the same payment: its deposit, then its release",
    "or refund.",
    "",
    "## Escrow contracts",
    "",
    `The published WASM is \`escrow.wasm\` in release [\`escrow-v0.3\`](${data.wasm.release}),`,
    `sha256 \`${data.wasm.hash}\`. For each contract, the script fetched the code`,
    "running on Testnet and compared its sha256 with that.",
    "",
    "| Contract | Holds | What it is | Runs the published WASM | Deployed | Initialized |",
    "| -------- | ----- | ---------- | ----------------------- | -------- | ----------- |",
  );
  for (const { contract: c, wasmMatches, txs } of contracts) {
    const deployed = c.deployTx ? `${txLink(c.deployTx)} ${when(txs.deployTx)}` : "not listed";
    const inited = c.initTx ? `${txLink(c.initTx)} ${when(txs.initTx)}` : "not listed";
    lines.push(
      `| ${contractLink(c.id)} | ${c.asset} | ${c.name}. ${c.note} | ${wasmMatches ? "Yes" : "**No**"} | ${deployed} | ${inited} |`,
    );
  }
  lines.push(
    "",
    "### Attestations",
    "",
    "HeyPay makes no separate attestation transaction. What attests to each escrow",
    "is on the chain already: the deploy transaction fixes the code it runs (checked",
    "against the published WASM above), and the `initialize` transaction fixes, for",
    "good, its admin and the one token it holds. The `set_timeout` calls below are",
    "the only changes ever made to the XLM escrow's settings. Every deposit,",
    "release and refund also emits the escrow's own event (`escrow`/`deposit`,",
    "`release`, `refund`, `refund_timeout`), which anyone can read from the",
    "transaction.",
    "",
  );

  for (const s of sections) {
    lines.push(
      `## ${s.deliverable}: ${s.title}`,
      "",
      "| What it proves | Call | Contract | Amount | Job | Signed by | Date (UTC) | Transaction |",
      "| -------------- | ---- | -------- | ------ | --- | --------- | ---------- | ----------- |",
    );
    for (const { entry, found } of s.rows) {
      const asset = assetOf(entry.contract);
      const stroops = found.stroops ?? depositedBy.get(found.jobId);
      const amount =
        found.detail ?? (stroops ? `${units(stroops)} ${asset}` : (found.amount ?? ""));
      const signer = found.signerChecked
        ? `**${signerLabel(found.source, data.accounts)}**, checked`
        : signerLabel(found.source, data.accounts);
      lines.push(
        `| ${entry.claim} | \`${entry.call}\` | ${entry.contract ? contractLink(entry.contract) : ""} | ${amount} | ${found.jobId ? `\`${found.jobId.slice(0, 8)}\`` : ""} | ${signer} | ${when(found.date)} | ${txLink(entry.tx)} |`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## Totals",
    "",
    `${all.length} transactions and ${contracts.length} contracts, all checked on Testnet on ${checkedAt}:`,
    `${count((r) => r.entry.call === "deposit")} deposits, ${count((r) => r.entry.call === "release")} releases,`,
    `${refunds} refunds (${timeoutRefunds} by the payer after the deadline), ${trustlines} USDC trustlines and`,
    `${swaps.size} swap directions.`,
    "",
  );
  return lines.join("\n");
}

async function main() {
  const data = JSON.parse(await readFile(SOURCE, "utf8"));
  if (data.network !== "testnet") throw new Error("receipts.mjs only checks Testnet");
  const server = new rpc.Server(RPC_URL);
  const problems = [];

  const contracts = await mapLimited(data.contracts, 2, async (contract) => {
    const r = await readContract(contract, data.wasm.hash, server);
    for (const p of r.problems) problems.push(`${contract.name} ${short(contract.id)}: ${p}`);
    return { contract, ...r };
  });
  const knownContracts = new Set(data.contracts.map((c) => c.id));

  const sections = [];
  for (const section of data.sections) {
    const rows = await mapLimited(section.receipts, 4, async (entry) => {
      if (entry.contract && !knownContracts.has(entry.contract)) {
        problems.push(`${section.deliverable} ${short(entry.tx)}: contract not in "contracts"`);
      }
      const found = await readReceipt(entry);
      if (found.problem)
        problems.push(`${section.deliverable} ${short(entry.tx)} ${found.problem}`);
      return { entry, found };
    });
    sections.push({ ...section, rows });
  }

  const txCount = sections.reduce((n, s) => n + s.rows.length, 0);
  if (problems.length > 0) {
    console.error(`${problems.length} problem(s); ${OUTPUT} was not written:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(`All ${txCount} transactions and ${contracts.length} contracts check out.`);
  if (checkOnly) return;

  const checkedAt = new Date().toISOString().slice(0, 10);
  // Formatted as the repo formats Markdown, so `pnpm format:check` passes.
  const markdown = await prettier.format(render(data, contracts, sections, checkedAt), {
    ...(await prettier.resolveConfig(OUTPUT)),
    parser: "markdown",
  });
  await writeFile(OUTPUT, markdown);
  console.log(`Wrote ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
