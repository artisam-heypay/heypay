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

export interface WalletService {
  generate(): { publicKey: string; encryptedSecret: string; secretKeyVersion: number };
  /** Native XLM balance. */
  getBalance(publicKey: string): Promise<Decimal>;
  /** Balances for the given assets, including whether a trustline exists. */
  getBalances(publicKey: string, assets?: readonly PaymentAsset[]): Promise<AssetBalance[]>;
  /** Whether `publicKey` exists and, for an issued asset, trusts its issuer. */
  canReceive(publicKey: string, asset: PaymentAsset): Promise<boolean>;
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
  /** Convenience wrapper over {@link sendAsset} for the native asset. */
  sendXlm(input: {
    encryptedSecret: string;
    destination: string;
    amountXlm: Decimal;
    memo: string;
  }): Promise<{ txHash: string }>;
  /** Idempotent `changeTrust`; a no-op when the trustline already exists. */
  establishTrustline(input: {
    encryptedSecret: string;
    asset: PaymentAsset;
    limit?: string;
  }): Promise<TrustlineResult>;
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

function describeStellarError(e: unknown): string | null {
  const extras = (
    e as { response?: { data?: { extras?: { result_codes?: Record<string, unknown> } } } }
  )?.response?.data?.extras;
  const codes = extras?.result_codes;
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

    sendXlm({ encryptedSecret, destination, amountXlm, memo }) {
      return service.sendAsset({
        encryptedSecret,
        destination,
        asset: "XLM",
        amount: amountXlm,
        memo,
      });
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
          items.push({
            id: rec.id,
            asset: "XLM",
            amount: dec(rec.starting_balance!),
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
