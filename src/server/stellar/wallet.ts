import "server-only";
import { Asset, Horizon, Keypair, Memo, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { Decimal, dec, formatXlm } from "@/lib/money";
import { decryptSecret, encryptSecret } from "@/server/crypto/envelope";
import { getHorizon, getNetworkPassphrase } from "./horizon";

export type IncomingPayment = {
  id: string;
  amountXlm: Decimal;
  from: string;
  txHash: string;
  createdAt: Date;
};

export interface WalletService {
  generate(): { publicKey: string; encryptedSecret: string; secretKeyVersion: number };
  getBalance(publicKey: string): Promise<Decimal>;
  sendXlm(input: {
    encryptedSecret: string;
    destination: string;
    amountXlm: Decimal;
    memo: string;
  }): Promise<{ txHash: string }>;
  confirmTx(txHash: string): Promise<boolean>;
  listIncomingPayments(
    publicKey: string,
    cursor?: string,
  ): Promise<{ items: IncomingPayment[]; cursor?: string }>;
}

type HorizonBalance = { asset_type: string; balance: string };
type HorizonPaymentRecord = {
  id: string;
  type: string;
  asset_type?: string;
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

export function createWalletService(
  server?: Horizon.Server,
  networkPassphrase?: string,
): WalletService {
  const srv = () => server ?? getHorizon();
  const net = () => networkPassphrase ?? getNetworkPassphrase();

  return {
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

    async sendXlm({ encryptedSecret, destination, amountXlm, memo }) {
      // Decrypt only here, in-memory; `secret` never leaves this scope.
      const secret = decryptSecret(encryptedSecret);
      const keypair = Keypair.fromSecret(secret);
      const account = await srv().loadAccount(keypair.publicKey());
      const baseFee = await srv().fetchBaseFee();
      const tx = new TransactionBuilder(account, {
        fee: String(baseFee),
        networkPassphrase: net(),
      })
        .addOperation(
          Operation.payment({
            destination,
            asset: Asset.native(),
            amount: formatXlm(amountXlm),
          }),
        )
        .addMemo(Memo.text(memo))
        .setTimeout(TX_TIMEOUT_SECONDS)
        .build();
      tx.sign(keypair);
      const res = await srv().submitTransaction(tx);
      return { txHash: res.hash };
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

    async listIncomingPayments(publicKey, cursor) {
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
            amountXlm: dec(rec.starting_balance!),
            from: rec.funder!,
            txHash: rec.transaction_hash,
            createdAt: new Date(rec.created_at),
          });
          continue;
        }
        if (rec.type !== "payment") continue;
        if (rec.asset_type !== "native") continue;
        if (rec.to !== publicKey) continue;
        items.push({
          id: rec.id,
          amountXlm: dec(rec.amount!),
          from: rec.from!,
          txHash: rec.transaction_hash,
          createdAt: new Date(rec.created_at),
        });
      }
      return { items, cursor: newCursor };
    },
  };
}

export const walletService: WalletService = createWalletService();
