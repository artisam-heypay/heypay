import "server-only";
import {
  Asset,
  Horizon,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
  type xdr,
} from "@stellar/stellar-sdk";
import { Decimal, dec, formatAsset } from "@/lib/money";
import { enabledAssets, isIssuedAsset, type PaymentAsset } from "@/lib/assets";
import { decryptSecret, encryptSecret } from "@/server/crypto/envelope";
import { assetCode, assetIssuer, matchPaymentAsset, resolveStellarAsset } from "./assets";
import { getHorizon, getNetworkPassphrase } from "./horizon";

export type IncomingPayment = {
  id: string;
  asset: PaymentAsset;
  amount: Decimal;
  from: string;
  txHash: string;
  createdAt: Date;
};

/** On-chain balance of one asset. `trustline` is always true for native XLM. */
export type AssetBalance = { asset: PaymentAsset; balance: Decimal; trustline: boolean };

export type TrustlineResult = { txHash: string | null; alreadyEstablished: boolean };

export type SponsoredActivation = {
  /** Null when the account already held every trustline and nothing was sent. */
  txHash: string | null;
  /** Whether the transaction created the account. */
  created: boolean;
  /** The assets whose trustline the transaction added. */
  trustlines: PaymentAsset[];
};

/** The two ways a path payment fixes its amounts. */
export type SwapLeg =
  /** Spend exactly `sendAmount`; receive at least `destMin`. */
  | { mode: "strict_send"; sendAmount: Decimal; destMin: Decimal }
  /** Receive exactly `destAmount`; spend at most `sendMax`. */
  | { mode: "strict_receive"; sendMax: Decimal; destAmount: Decimal };

export type SwapResult = {
  txHash: string;
  /**
   * False when the network took the transaction and the conversion failed.
   * Nothing was converted, but the fee was charged.
   */
  ok: boolean;
  /** What left the account in the send asset. Zero when `ok` is false. */
  sent: Decimal;
  /** What arrived in the destination asset. Zero when `ok` is false. */
  received: Decimal;
  /** The network fee the transaction was charged, in XLM. */
  feeXlm: Decimal;
  /** The operation result code of a failed conversion, when Horizon reported one. */
  failure: string | null;
};

/** What Horizon knows of a swap that was sent, when it is asked again later. */
export type SwapLookup =
  /** A ledger took it. `result` is what `swap` would have returned. */
  | { state: "landed"; result: SwapResult }
  /** No ledger took it and none can any more: nothing moved, no fee was charged. */
  | { state: "expired" }
  /** No ledger has it yet, and one still might. */
  | { state: "pending" };

/**
 * A swap was sent and Horizon could not say whether a ledger took it. Whatever
 * it would have spent must stay on hold until someone looks the hash up.
 */
export class SwapOutcomeUnknownError extends Error {
  constructor(
    public readonly txHash: string,
    cause: unknown,
  ) {
    super(`swap ${txHash} was submitted but its outcome could not be read`, { cause });
    this.name = "SwapOutcomeUnknownError";
  }
}

export interface WalletService {
  generate(): { publicKey: string; encryptedSecret: string; secretKeyVersion: number };
  /** Native XLM balance. */
  getBalance(publicKey: string): Promise<Decimal>;
  /** Balances for the given assets, including whether a trustline exists. */
  getBalances(publicKey: string, assets?: readonly PaymentAsset[]): Promise<AssetBalance[]>;
  /** Whether `publicKey` exists and, for an issued asset, trusts its issuer. */
  canReceive(publicKey: string, asset: PaymentAsset): Promise<boolean>;
  /**
   * Whether `publicKey` holds an asset with `asset`'s code from another issuer.
   * That is a different asset: it shows as "USDC" in other wallets, but it is
   * not the USDC HeyPay accepts and cannot pay here.
   */
  holdsOtherIssuer(publicKey: string, asset: PaymentAsset): Promise<boolean>;
  sendAsset(input: {
    encryptedSecret: string;
    destination: string;
    asset: PaymentAsset;
    amount: Decimal;
    memo: string;
  }): Promise<{ txHash: string }>;
  /**
   * Sends exactly `amount` of `asset`, converting it on the DEX so the
   * destination receives at least `destMin` of `destAsset`. The transaction
   * fails on-chain (op_under_dest_min) rather than delivering less — the rail
   * must never be short-changed, and the payer must never be over-charged.
   */
  sendAssetViaPath(input: {
    encryptedSecret: string;
    destination: string;
    asset: PaymentAsset;
    amount: Decimal;
    destAsset: PaymentAsset;
    destMin: Decimal;
    path: Asset[];
    memo: string;
  }): Promise<{ txHash: string }>;
  /**
   * Converts `sendAsset` into `destAsset` inside the wallet's own account with
   * one path payment to itself. Throws when the transaction never reached a
   * ledger, so nothing moved and no fee was charged; a transaction the network
   * took and failed comes back with `ok: false`. Throws
   * {@link SwapOutcomeUnknownError} when it was sent and cannot be found out.
   */
  swap(
    input: {
      encryptedSecret: string;
      sendAsset: PaymentAsset;
      destAsset: PaymentAsset;
      path: Asset[];
      /** The fee the transaction bids, and so the most it can be charged. */
      feeXlm: Decimal;
    } & SwapLeg,
  ): Promise<SwapResult>;
  /**
   * Asks again about a swap that was sent no later than `sentBy`, by its hash.
   * It is `expired` only once Horizon holds a ledger that closed after the last
   * moment the swap could be taken. Throws when Horizon cannot be read, or
   * cannot say what a swap that went through moved.
   */
  swapOutcome(txHash: string, sentBy: Date): Promise<SwapLookup>;
  /**
   * The XLM the network keeps locked in the account: its minimum balance plus
   * what its open offers are selling. Zero for an account that does not exist.
   */
  lockedXlm(publicKey: string): Promise<Decimal>;
  /** Convenience wrapper over {@link sendAsset} for the native asset. */
  sendXlm(input: {
    encryptedSecret: string;
    destination: string;
    amountXlm: Decimal;
    memo: string;
  }): Promise<{ txHash: string }>;
  /**
   * Sends `amountXlm` to `destination`, creating the account (createAccount)
   * when it does not exist on the network yet — a brand-new custodial wallet
   * cannot receive a plain payment until something funds it.
   */
  fundXlm(input: {
    encryptedSecret: string;
    destination: string;
    amountXlm: Decimal;
    memo: string;
  }): Promise<{ txHash: string; created: boolean }>;
  /** Idempotent `changeTrust`; a no-op when the trustline already exists. */
  establishTrustline(input: {
    encryptedSecret: string;
    asset: PaymentAsset;
    limit?: string;
  }): Promise<TrustlineResult>;
  /**
   * Adds the trustlines the wallet lacks for `assets`, creating its account
   * first when the network has none, all paid for by the sponsor: the reserves
   * stay locked in the sponsor's balance (sponsored reserves) and the sponsor
   * pays the fee. The wallet receives no XLM, so nothing is added to what its
   * owner holds or can spend. A no-op when no trustline is missing.
   */
  activateSponsored(input: {
    sponsorEncryptedSecret: string;
    encryptedSecret: string;
    assets: readonly PaymentAsset[];
  }): Promise<SponsoredActivation>;
  confirmTx(txHash: string): Promise<boolean>;
  listIncomingPayments(
    publicKey: string,
    cursor?: string,
    assets?: readonly PaymentAsset[],
  ): Promise<{ items: IncomingPayment[]; cursor?: string }>;
}

type HorizonBalance = {
  asset_type: string;
  balance: string;
  asset_code?: string;
  asset_issuer?: string;
};
type HorizonPaymentRecord = {
  id: string;
  type: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  to?: string;
  from?: string;
  amount?: string;
  // create_account operations (a brand-new account's very first deposit) carry
  // these instead of to/from/amount/asset_type — always native XLM.
  account?: string;
  funder?: string;
  starting_balance?: string;
  transaction_hash: string;
  created_at: string;
  paging_token: string;
};

const TX_TIMEOUT_SECONDS = 180;
// A swap is quoted seconds before it is sent, so it is not left valid for long.
// Shorter than the confirm window below: a swap not found by then never will be.
const SWAP_TIMEOUT_SECONDS = 30;
// Allowed between this server's clock and the network's before a swap that is
// in no ledger is called expired.
const SWAP_CLOCK_SLACK_SECONDS = 60;
/** One base reserve: an account keeps two, plus one for each subentry. */
const BASE_RESERVE_XLM = dec("0.5");
const STROOPS_PER_XLM = 10_000_000;
const CONFIRM_MAX_ATTEMPTS = 20;
const CONFIRM_DELAY_MS = 2000;
const PAGE_LIMIT = 50;

function isNotFound(e: unknown): boolean {
  const err = e as { name?: string; response?: { status?: number } };
  return err?.name === "NotFoundError" || err?.response?.status === 404;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Horizon rejects a bad transaction with a bare HTTP 400, which the SDK's axios
 * surfaces as "Request failed with status code 400" — useless to anyone reading
 * a log or an error toast. The reason lives in `extras.result_codes`; translate
 * the ones we can actually cause into something a human can act on.
 */
const OP_RESULT_HELP: Record<string, string> = {
  op_no_trust: "the destination account does not accept this asset (no trustline)",
  op_underfunded: "the sending account does not hold enough of this asset",
  op_no_destination: "the destination account does not exist on this network",
  op_line_full: "the destination's trustline limit for this asset is full",
  op_no_issuer: "the asset's issuer account does not exist on this network",
  op_low_reserve: "the account would drop below its minimum XLM reserve",
};

/** Horizon's result codes for a rejected submission, or null when it gave none. */
function resultCodes(e: unknown): Record<string, unknown> | null {
  const extras = (
    e as { response?: { data?: { extras?: { result_codes?: Record<string, unknown> } } } }
  )?.response?.data?.extras;
  return extras?.result_codes ?? null;
}

function describeStellarError(e: unknown): string | null {
  const codes = resultCodes(e);
  if (!codes) return null;
  const opCodes = Array.isArray(codes.operations) ? (codes.operations as string[]) : [];
  const failing = opCodes.find((c) => c !== "op_success");
  const txCode = typeof codes.transaction === "string" ? codes.transaction : "tx_failed";
  const help = failing ? OP_RESULT_HELP[failing] : undefined;
  const detail = failing ?? txCode;
  return help
    ? `Stellar rejected the transaction: ${help} (${detail})`
    : `Stellar rejected the transaction (${detail})`;
}

/** Rethrow Horizon submission failures with the on-chain reason attached. */
function rethrowStellarError(e: unknown): never {
  const described = describeStellarError(e);
  if (!described) throw e;
  const err = new Error(described, { cause: e });
  err.name = "StellarSubmitError";
  throw err;
}

/** Find the Horizon balance line for `asset`, or undefined when no trustline exists. */
function findBalance(balances: HorizonBalance[], asset: PaymentAsset): HorizonBalance | undefined {
  if (!isIssuedAsset(asset)) return balances.find((b) => b.asset_type === "native");
  const issuer = assetIssuer(asset);
  if (!issuer) return undefined;
  return balances.find((b) => b.asset_code === assetCode(asset) && b.asset_issuer === issuer);
}

export function createWalletService(
  server?: Horizon.Server,
  networkPassphrase?: string,
): WalletService {
  const srv = () => server ?? getHorizon();
  const net = () => networkPassphrase ?? getNetworkPassphrase();

  /** Build, sign and submit a single-operation transaction from the wallet's account. */
  async function submitOp(
    encryptedSecret: string,
    buildOp: () => xdr.Operation,
    memo?: string,
  ): Promise<string> {
    // Decrypt only here, in-memory; `secret` never leaves this scope.
    const secret = decryptSecret(encryptedSecret);
    const keypair = Keypair.fromSecret(secret);
    const account = await srv().loadAccount(keypair.publicKey());
    const baseFee = await srv().fetchBaseFee();
    let builder = new TransactionBuilder(account, {
      fee: String(baseFee),
      networkPassphrase: net(),
    }).addOperation(buildOp());
    if (memo !== undefined) builder = builder.addMemo(Memo.text(memo));
    const tx = builder.setTimeout(TX_TIMEOUT_SECONDS).build();
    tx.sign(keypair);
    try {
      const res = await srv().submitTransaction(tx);
      return res.hash;
    } catch (e) {
      rethrowStellarError(e);
    }
  }

  /**
   * The transaction as a ledger recorded it, or null when it is in none. Waits
   * out the confirm window by default; `attempts` of 1 asks once.
   */
  async function findTx(
    txHash: string,
    attempts = CONFIRM_MAX_ATTEMPTS,
  ): Promise<{ successful: boolean; feeCharged: Decimal } | null> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const tx = await srv().transactions().transaction(txHash).call();
        return {
          successful: tx.successful === true,
          feeCharged: dec(String(tx.fee_charged)).div(STROOPS_PER_XLM),
        };
      } catch (e) {
        if (!isNotFound(e)) throw e;
        if (attempt < attempts - 1) await sleep(CONFIRM_DELAY_MS);
      }
    }
    return null;
  }

  /** What a path payment spent and delivered, or null when Horizon cannot say. */
  async function readPathPayment(
    txHash: string,
  ): Promise<{ sent: Decimal; received: Decimal } | null> {
    try {
      const page = await srv().operations().forTransaction(txHash).call();
      const [op] = page.records as unknown as { source_amount?: string; amount?: string }[];
      if (!op?.source_amount || !op.amount) return null;
      return { sent: dec(op.source_amount), received: dec(op.amount) };
    } catch {
      return null;
    }
  }

  const service: WalletService = {
    generate() {
      const kp = Keypair.random();
      const secretKeyVersion = Number(process.env.ENCRYPTION_KEY_VERSION ?? "1");
      return {
        publicKey: kp.publicKey(),
        encryptedSecret: encryptSecret(kp.secret()),
        secretKeyVersion,
      };
    },

    async getBalance(publicKey) {
      try {
        const account = await srv().loadAccount(publicKey);
        const balances = account.balances as HorizonBalance[];
        const native = balances.find((b) => b.asset_type === "native");
        return native ? dec(native.balance) : new Decimal(0);
      } catch (e) {
        if (isNotFound(e)) return new Decimal(0);
        throw e;
      }
    },

    async getBalances(publicKey, assets = enabledAssets()) {
      let balances: HorizonBalance[] = [];
      try {
        const account = await srv().loadAccount(publicKey);
        balances = account.balances as HorizonBalance[];
      } catch (e) {
        // Account not created/funded yet → zero everywhere, no trustlines.
        if (!isNotFound(e)) throw e;
      }
      return assets.map((asset) => {
        const line = findBalance(balances, asset);
        return {
          asset,
          balance: line ? dec(line.balance) : new Decimal(0),
          // Native XLM needs no trustline; an issued asset has one iff Horizon
          // reports a balance line for that exact code:issuer pair.
          trustline: isIssuedAsset(asset) ? line !== undefined : true,
        };
      });
    },

    async canReceive(publicKey, asset) {
      try {
        const account = await srv().loadAccount(publicKey);
        if (!isIssuedAsset(asset)) return true; // any existing account accepts XLM
        const balances = account.balances as HorizonBalance[];
        return findBalance(balances, asset) !== undefined;
      } catch (e) {
        if (isNotFound(e)) return false; // account doesn't exist on this network
        throw e;
      }
    },

    async holdsOtherIssuer(publicKey, asset) {
      if (!isIssuedAsset(asset)) return false; // XLM has no issuer to differ
      const issuer = assetIssuer(asset);
      try {
        const account = await srv().loadAccount(publicKey);
        const balances = account.balances as HorizonBalance[];
        return balances.some(
          (b) =>
            b.asset_code === assetCode(asset) &&
            b.asset_issuer !== issuer &&
            dec(b.balance).greaterThan(0),
        );
      } catch (e) {
        if (isNotFound(e)) return false;
        throw e;
      }
    },

    async sendAsset({ encryptedSecret, destination, asset, amount, memo }) {
      const stellarAsset = resolveStellarAsset(asset);
      const txHash = await submitOp(
        encryptedSecret,
        () =>
          Operation.payment({
            destination,
            asset: stellarAsset,
            amount: formatAsset(amount),
          }),
        memo,
      );
      return { txHash };
    },

    async sendAssetViaPath({
      encryptedSecret,
      destination,
      asset,
      amount,
      destAsset,
      destMin,
      path,
      memo,
    }) {
      const sendAsset = resolveStellarAsset(asset);
      const receiveAsset = resolveStellarAsset(destAsset);
      const txHash = await submitOp(
        encryptedSecret,
        () =>
          Operation.pathPaymentStrictSend({
            sendAsset,
            sendAmount: formatAsset(amount),
            destination,
            destAsset: receiveAsset,
            destMin: formatAsset(destMin),
            path,
          }),
        memo,
      );
      return { txHash };
    },

    async swap({ encryptedSecret, sendAsset, destAsset, path, feeXlm, ...leg }) {
      const keypair = Keypair.fromSecret(decryptSecret(encryptedSecret));
      const self = keypair.publicKey();
      const from = resolveStellarAsset(sendAsset);
      const to = resolveStellarAsset(destAsset);
      const op =
        leg.mode === "strict_send"
          ? Operation.pathPaymentStrictSend({
              sendAsset: from,
              sendAmount: formatAsset(leg.sendAmount),
              destination: self,
              destAsset: to,
              destMin: formatAsset(leg.destMin),
              path,
            })
          : Operation.pathPaymentStrictReceive({
              sendAsset: from,
              sendMax: formatAsset(leg.sendMax),
              destination: self,
              destAsset: to,
              destAmount: formatAsset(leg.destAmount),
              path,
            });
      const account = await srv().loadAccount(self);
      const tx = new TransactionBuilder(account, {
        fee: feeXlm.times(STROOPS_PER_XLM).toFixed(0),
        networkPassphrase: net(),
      })
        .addOperation(op)
        .setTimeout(SWAP_TIMEOUT_SECONDS)
        .build();
      tx.sign(keypair);
      const txHash = tx.hash().toString("hex");

      let failure: string | null = null;
      let ok = true;
      try {
        await srv().submitTransaction(tx);
      } catch (e) {
        const codes = resultCodes(e);
        if (codes?.transaction === "tx_failed") {
          // In a ledger, and the conversion failed there: the fee is gone.
          const ops = Array.isArray(codes.operations) ? (codes.operations as string[]) : [];
          failure = ops.find((c) => c !== "op_success") ?? null;
          ok = false;
        } else if (codes) {
          rethrowStellarError(e); // refused before any ledger: nothing was charged
        } else {
          // No answer from Horizon. The transaction may still have gone through,
          // so ask for it by hash before calling it lost.
          const landed = await findTx(txHash).catch((lookupErr) => {
            throw new SwapOutcomeUnknownError(txHash, lookupErr);
          });
          if (!landed) throw e; // expired unseen: it can no longer go through
          ok = landed.successful;
        }
      }

      // Past this point the transaction is in a ledger, so nothing below may throw.
      const charged = (await findTx(txHash, 1).catch(() => null))?.feeCharged ?? feeXlm;
      if (!ok) {
        return { txHash, ok, sent: dec(0), received: dec(0), feeXlm: charged, failure };
      }
      // What moved is the chain's to say: a strict send can deliver more than
      // its minimum and a strict receive can spend less than its maximum. If it
      // cannot be read, the bounds are the amounts that are certain.
      const moved = await readPathPayment(txHash);
      return {
        txHash,
        ok,
        sent: moved?.sent ?? (leg.mode === "strict_send" ? leg.sendAmount : leg.sendMax),
        received: moved?.received ?? (leg.mode === "strict_send" ? leg.destMin : leg.destAmount),
        feeXlm: charged,
        failure: null,
      };
    },

    async swapOutcome(txHash, sentBy) {
      // The latest ledger is read before the transaction is looked for. Horizon
      // takes ledgers in order, so if it already held one that closed after the
      // swap's time limit, a swap it then does not have is in no ledger.
      const latest = await srv().ledgers().order("desc").limit(1).call();
      const latestClose = Date.parse(latest.records[0]?.closed_at ?? "");
      const landed = await findTx(txHash, 1);
      if (!landed) {
        const lastChance =
          sentBy.getTime() + (SWAP_TIMEOUT_SECONDS + SWAP_CLOCK_SLACK_SECONDS) * 1000;
        return { state: latestClose > lastChance ? "expired" : "pending" };
      }
      if (!landed.successful) {
        return {
          state: "landed",
          result: {
            txHash,
            ok: false,
            sent: dec(0),
            received: dec(0),
            feeXlm: landed.feeCharged,
            failure: null,
          },
        };
      }
      // Asked for later, there are no bounds to fall back on: wait for Horizon.
      const moved = await readPathPayment(txHash);
      if (!moved) throw new Error(`swap ${txHash} went through but what it moved cannot be read`);
      return {
        state: "landed",
        result: { txHash, ok: true, ...moved, feeXlm: landed.feeCharged, failure: null },
      };
    },

    async lockedXlm(publicKey) {
      try {
        const account = await srv().loadAccount(publicKey);
        const native = (account.balances as (HorizonBalance & { selling_liabilities?: string })[]) //
          .find((b) => b.asset_type === "native");
        const entries =
          2 + account.subentry_count + (account.num_sponsoring ?? 0) - (account.num_sponsored ?? 0);
        return BASE_RESERVE_XLM.times(entries).plus(dec(native?.selling_liabilities ?? "0"));
      } catch (e) {
        if (isNotFound(e)) return dec(0);
        throw e;
      }
    },

    sendXlm({ encryptedSecret, destination, amountXlm, memo }) {
      return service.sendAsset({
        encryptedSecret,
        destination,
        asset: "XLM",
        amount: amountXlm,
        memo,
      });
    },

    async fundXlm({ encryptedSecret, destination, amountXlm, memo }) {
      let exists = true;
      try {
        await srv().loadAccount(destination);
      } catch (e) {
        if (!isNotFound(e)) throw e;
        exists = false;
      }
      const amount = formatAsset(amountXlm);
      const txHash = await submitOp(
        encryptedSecret,
        () =>
          exists
            ? Operation.payment({ destination, asset: Asset.native(), amount })
            : Operation.createAccount({ destination, startingBalance: amount }),
        memo,
      );
      return { txHash, created: !exists };
    },

    async establishTrustline({ encryptedSecret, asset, limit }) {
      if (!isIssuedAsset(asset)) {
        // Native XLM needs no trustline — treat as already established.
        return { txHash: null, alreadyEstablished: true };
      }
      const stellarAsset = resolveStellarAsset(asset);
      const secret = decryptSecret(encryptedSecret);
      const publicKey = Keypair.fromSecret(secret).publicKey();

      // Idempotency: a changeTrust for an existing line succeeds but burns a fee
      // and (with a lower limit than the held balance) can fail outright.
      const [existing] = await service.getBalances(publicKey, [asset]);
      if (existing?.trustline) return { txHash: null, alreadyEstablished: true };

      const txHash = await submitOp(encryptedSecret, () =>
        Operation.changeTrust(limit ? { asset: stellarAsset, limit } : { asset: stellarAsset }),
      );
      return { txHash, alreadyEstablished: false };
    },

    async activateSponsored({ sponsorEncryptedSecret, encryptedSecret, assets }) {
      const sponsor = Keypair.fromSecret(decryptSecret(sponsorEncryptedSecret));
      const wallet = Keypair.fromSecret(decryptSecret(encryptedSecret));
      const walletKey = wallet.publicKey();

      let created = false;
      let held: HorizonBalance[] = [];
      try {
        held = (await srv().loadAccount(walletKey)).balances as HorizonBalance[];
      } catch (e) {
        if (!isNotFound(e)) throw e;
        created = true;
      }
      const trustlines = assets.filter((a) => isIssuedAsset(a) && !findBalance(held, a));
      if (trustlines.length === 0) return { txHash: null, created: false, trustlines };

      // Everything between begin and end is the sponsor's to pay reserve for.
      // The sponsor is the transaction's source, so it pays the fee as well.
      const account = await srv().loadAccount(sponsor.publicKey());
      const baseFee = await srv().fetchBaseFee();
      const builder = new TransactionBuilder(account, {
        fee: String(baseFee),
        networkPassphrase: net(),
      }).addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: walletKey }));
      if (created) {
        // A sponsored account needs no starting balance: it is created empty.
        builder.addOperation(
          Operation.createAccount({ destination: walletKey, startingBalance: "0" }),
        );
      }
      for (const asset of trustlines) {
        builder.addOperation(
          Operation.changeTrust({ asset: resolveStellarAsset(asset), source: walletKey }),
        );
      }
      // Closing the sponsorship is the wallet's consent to it, so it signs too.
      builder.addOperation(Operation.endSponsoringFutureReserves({ source: walletKey }));
      const tx = builder.setTimeout(TX_TIMEOUT_SECONDS).build();
      tx.sign(sponsor, wallet);
      try {
        const res = await srv().submitTransaction(tx);
        return { txHash: res.hash, created, trustlines };
      } catch (e) {
        rethrowStellarError(e);
      }
    },

    async confirmTx(txHash) {
      for (let attempt = 0; attempt < CONFIRM_MAX_ATTEMPTS; attempt++) {
        try {
          const tx = await srv().transactions().transaction(txHash).call();
          return tx.successful === true; // found in ledger -> definitive
        } catch (e) {
          if (!isNotFound(e)) throw e; // real error -> bubble up
          if (attempt < CONFIRM_MAX_ATTEMPTS - 1) await sleep(CONFIRM_DELAY_MS);
        }
      }
      return false; // never appeared within the window -> treat as not confirmed
    },

    async listIncomingPayments(publicKey, cursor, assets = enabledAssets()) {
      let builder = srv().payments().forAccount(publicKey).order("asc").limit(PAGE_LIMIT);
      if (cursor) builder = builder.cursor(cursor);
      let page;
      try {
        page = await builder.call();
      } catch (e) {
        // Account not created/funded yet → no incoming payments to report (not an error).
        if (isNotFound(e)) return { items: [], cursor };
        throw e;
      }
      const records = page.records as unknown as HorizonPaymentRecord[];
      const items: IncomingPayment[] = [];
      let newCursor = cursor;
      for (const rec of records) {
        newCursor = rec.paging_token;
        // A wallet's very first-ever deposit funds a not-yet-existing account, which
        // Stellar records as create_account (not payment) — must be treated as incoming too.
        if (rec.type === "create_account") {
          if (rec.account !== publicKey) continue;
          const startingBalance = dec(rec.starting_balance!);
          // A sponsored account is created empty: nothing was deposited.
          if (startingBalance.isZero()) continue;
          items.push({
            id: rec.id,
            asset: "XLM",
            amount: startingBalance,
            from: rec.funder!,
            txHash: rec.transaction_hash,
            createdAt: new Date(rec.created_at),
          });
          continue;
        }
        if (rec.type !== "payment") continue;
        if (rec.to !== publicKey) continue;
        // Assets we don't accept (including a same-code asset from a different,
        // untrusted issuer) are ignored rather than credited.
        const asset = matchPaymentAsset(rec, assets);
        if (!asset) continue;
        items.push({
          id: rec.id,
          asset,
          amount: dec(rec.amount!),
          from: rec.from!,
          txHash: rec.transaction_hash,
          createdAt: new Date(rec.created_at),
        });
      }
      return { items, cursor: newCursor };
    },
  };

  return service;
}

export const walletService: WalletService = createWalletService();
