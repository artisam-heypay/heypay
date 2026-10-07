import { randomBytes } from "node:crypto";
import type { Horizon } from "@stellar/stellar-sdk";
import { StrKey } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "@/lib/money";
import { __resetKeyringForTests, decryptSecret } from "@/server/crypto/envelope";
import { createWalletService } from "@/server/stellar/wallet";

const PASSPHRASE = "Test SDF Network ; September 2015";

beforeEach(() => {
  process.env.ENCRYPTION_MASTER_KEY = `base64:${randomBytes(32).toString("base64")}`;
  process.env.ENCRYPTION_KEY_VERSION = "1";
  __resetKeyringForTests();
});

// Minimal chainable fake of the Horizon.Server surface the wallet uses.
function fakeServer(overrides: Partial<Record<string, unknown>> = {}) {
  const base = {
    loadAccount: vi.fn(),
    fetchBaseFee: vi.fn().mockResolvedValue(100),
    submitTransaction: vi.fn(),
    transactions: vi.fn(),
    payments: vi.fn(),
    ...overrides,
  };
  return base as unknown as Horizon.Server;
}

describe("WalletService.generate", () => {
  it("produces a valid G-public key and a decryptable S-secret", () => {
    const svc = createWalletService(fakeServer(), PASSPHRASE);
    const { publicKey, encryptedSecret, secretKeyVersion } = svc.generate();
    expect(StrKey.isValidEd25519PublicKey(publicKey)).toBe(true);
    expect(publicKey.startsWith("G")).toBe(true);
    expect(secretKeyVersion).toBe(1);
    const secret = decryptSecret(encryptedSecret);
    expect(StrKey.isValidEd25519SecretSeed(secret)).toBe(true);
    expect(secret.startsWith("S")).toBe(true);
  });
});

describe("WalletService.getBalance", () => {
  it("parses the native balance from a Horizon account", async () => {
    const server = fakeServer({
      loadAccount: vi.fn().mockResolvedValue({
        balances: [
          { asset_type: "credit_alphanum4", balance: "5.0" },
          { asset_type: "native", balance: "123.4567890" },
        ],
      }),
    });
    const svc = createWalletService(server, PASSPHRASE);
    const bal = await svc.getBalance("GABC");
    expect(bal.equals(new Decimal("123.4567890"))).toBe(true);
  });

  it("returns 0 when the account is not yet funded (404)", async () => {
    const server = fakeServer({
      loadAccount: vi.fn().mockRejectedValue({ name: "NotFoundError", response: { status: 404 } }),
    });
    const svc = createWalletService(server, PASSPHRASE);
    expect((await svc.getBalance("GABC")).isZero()).toBe(true);
  });
});

describe("WalletService.sendXlm", () => {
  it("builds a native payment with memo and submits it", async () => {
    const sourceSvc = createWalletService(fakeServer(), PASSPHRASE);
    const { publicKey, encryptedSecret } = sourceSvc.generate();
    const submit = vi.fn().mockResolvedValue({ hash: "deadbeef" });
    const server = fakeServer({
      loadAccount: vi.fn().mockResolvedValue({
        accountId: () => publicKey,
        sequenceNumber: () => "1",
        incrementSequenceNumber: () => undefined,
      }),
      fetchBaseFee: vi.fn().mockResolvedValue(100),
      submitTransaction: submit,
    });
    const svc = createWalletService(server, PASSPHRASE);
    const res = await svc.sendXlm({
      encryptedSecret,
      destination: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      amountXlm: new Decimal("12.5"),
      memo: "TXN-ABC123",
    });
    expect(res.txHash).toBe("deadbeef");
    expect(submit).toHaveBeenCalledTimes(1);
    const tx = submit.mock.calls[0]![0]! as {
      memo: { value: { toString: () => string } };
      operations: { type: string; amount: string; asset: { isNative: () => boolean } }[];
      timeBounds: { maxTime: string };
    };
    expect(tx.memo.value.toString()).toBe("TXN-ABC123");
    expect(tx.operations[0]!.type).toBe("payment");
    expect(tx.operations[0]!.amount).toBe("12.5000000"); // 7dp formatXlm
    expect(tx.operations[0]!.asset.isNative()).toBe(true);
    expect(tx.timeBounds.maxTime).not.toBe("0"); // setTimeout applied
  });
});

describe("WalletService.fundXlm", () => {
  const DEST = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37";

  async function fundWith(destinationExists: boolean) {
    const seed = createWalletService(fakeServer(), PASSPHRASE);
    const { publicKey, encryptedSecret } = seed.generate();
    const submit = vi.fn().mockResolvedValue({ hash: "fundhash" });
    const loadAccount = vi.fn(async (id: string) => {
      if (id === DEST && !destinationExists) {
        throw { name: "NotFoundError", response: { status: 404 } };
      }
      return {
        accountId: () => publicKey,
        sequenceNumber: () => "1",
        incrementSequenceNumber: () => undefined,
      };
    });
    const svc = createWalletService(
      fakeServer({ loadAccount, submitTransaction: submit }),
      PASSPHRASE,
    );
    const res = await svc.fundXlm({
      encryptedSecret,
      destination: DEST,
      amountXlm: new Decimal("20"),
      memo: "HeyPay test XLM",
    });
    const tx = submit.mock.calls[0]![0]! as {
      memo: { value: { toString: () => string } };
      operations: { type: string; amount?: string; startingBalance?: string }[];
    };
    return { res, tx };
  }

  it("creates the destination account when it does not exist yet", async () => {
    const { res, tx } = await fundWith(false);
    expect(res).toEqual({ txHash: "fundhash", created: true });
    expect(tx.operations[0]!.type).toBe("createAccount");
    expect(tx.operations[0]!.startingBalance).toBe("20.0000000");
    expect(tx.memo.value.toString()).toBe("HeyPay test XLM");
  });

  it("sends a plain payment to an existing account", async () => {
    const { res, tx } = await fundWith(true);
    expect(res).toEqual({ txHash: "fundhash", created: false });
    expect(tx.operations[0]!.type).toBe("payment");
    expect(tx.operations[0]!.amount).toBe("20.0000000");
  });
});

describe("WalletService submit-error translation", () => {
  /** A Horizon 400 as the SDK's axios surfaces it: a useless message, real codes. */
  const horizon400 = (operations: string[]) =>
    Object.assign(new Error("Request failed with status code 400"), {
      response: { data: { extras: { result_codes: { transaction: "tx_failed", operations } } } },
    });

  async function sendWith(error: unknown) {
    const seed = createWalletService(fakeServer(), PASSPHRASE);
    const { publicKey, encryptedSecret } = seed.generate();
    const server = fakeServer({
      loadAccount: vi.fn().mockResolvedValue({
        accountId: () => publicKey,
        sequenceNumber: () => "1",
        incrementSequenceNumber: () => undefined,
      }),
      fetchBaseFee: vi.fn().mockResolvedValue(100),
      submitTransaction: vi.fn().mockRejectedValue(error),
    });
    return createWalletService(server, PASSPHRASE).sendXlm({
      encryptedSecret,
      destination: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      amountXlm: new Decimal("1"),
      memo: "TXN-1",
    });
  }

  it("explains op_no_trust rather than 'Request failed with status code 400'", async () => {
    await expect(sendWith(horizon400(["op_no_trust"]))).rejects.toThrow(
      /destination account does not accept this asset.*op_no_trust/,
    );
  });

  it("explains op_underfunded", async () => {
    await expect(sendWith(horizon400(["op_underfunded"]))).rejects.toThrow(
      /does not hold enough of this asset/,
    );
  });

  it("names an unmapped operation code rather than swallowing it", async () => {
    await expect(sendWith(horizon400(["op_malformed"]))).rejects.toThrow(/op_malformed/);
  });

  it("rethrows an error carrying no Horizon result codes", async () => {
    await expect(sendWith(new Error("socket hang up"))).rejects.toThrow("socket hang up");
  });
});

describe("WalletService.confirmTx", () => {
  it("returns true for a successful tx", async () => {
    const call = vi.fn().mockResolvedValue({ successful: true });
    const server = fakeServer({
      transactions: vi.fn().mockReturnValue({ transaction: () => ({ call }) }),
    });
    const svc = createWalletService(server, PASSPHRASE);
    expect(await svc.confirmTx("abc")).toBe(true);
  });

  it("returns false for a failed tx", async () => {
    const call = vi.fn().mockResolvedValue({ successful: false });
    const server = fakeServer({
      transactions: vi.fn().mockReturnValue({ transaction: () => ({ call }) }),
    });
    const svc = createWalletService(server, PASSPHRASE);
    expect(await svc.confirmTx("abc")).toBe(false);
  });
});

describe("WalletService.listIncomingPayments", () => {
  it("maps native incoming payments and returns the new cursor", async () => {
    const records = [
      {
        id: "1",
        type: "payment",
        asset_type: "native",
        to: "GME",
        from: "GX",
        amount: "10.0",
        transaction_hash: "h1",
        created_at: "2026-06-28T00:00:00Z",
        paging_token: "c1",
      },
      {
        id: "2",
        type: "payment",
        asset_type: "native",
        to: "GOTHER",
        from: "GX",
        amount: "5.0",
        transaction_hash: "h2",
        created_at: "2026-06-28T00:01:00Z",
        paging_token: "c2",
      },
      {
        // create_account carries account/funder/starting_balance, never to/from/amount.
        id: "3",
        type: "create_account",
        account: "GME",
        funder: "GX",
        starting_balance: "1.0",
        transaction_hash: "h3",
        created_at: "2026-06-28T00:02:00Z",
        paging_token: "c3",
      },
    ];
    const call = vi.fn().mockResolvedValue({ records });
    const builder = { order: vi.fn(), limit: vi.fn(), cursor: vi.fn(), call };
    builder.order.mockReturnValue(builder);
    builder.limit.mockReturnValue(builder);
    builder.cursor.mockReturnValue(builder);
    const server = fakeServer({
      payments: vi.fn().mockReturnValue({ forAccount: vi.fn().mockReturnValue(builder) }),
    });
    const svc = createWalletService(server, PASSPHRASE);
    const out = await svc.listIncomingPayments("GME", "c0");
    // payment TO GME, and the create_account that first funded GME; GOTHER's excluded.
    expect(out.items).toHaveLength(2);
    expect(out.items[0]!.txHash).toBe("h1");
    expect(out.items[0]!.amount.equals(new Decimal("10.0"))).toBe(true);
    expect(out.items[0]!.asset).toBe("XLM");
    expect(out.items[1]!.txHash).toBe("h3");
    expect(out.items[1]!.amount.equals(new Decimal("1.0"))).toBe(true);
    expect(out.items[1]!.from).toBe("GX");
    expect(out.cursor).toBe("c3"); // advances past every scanned record
    expect(builder.cursor).toHaveBeenCalledWith("c0");
  });

  it("does not report a sponsored account's empty creation as a deposit", async () => {
    const records = [
      {
        id: "1",
        type: "create_account",
        account: "GME",
        funder: "GSPONSOR",
        starting_balance: "0.0000000",
        transaction_hash: "h1",
        created_at: "2026-10-07T00:00:00Z",
        paging_token: "c1",
      },
    ];
    const builder = {
      order: vi.fn(),
      limit: vi.fn(),
      cursor: vi.fn(),
      call: vi.fn().mockResolvedValue({ records }),
    };
    builder.order.mockReturnValue(builder);
    builder.limit.mockReturnValue(builder);
    const server = fakeServer({
      payments: vi.fn().mockReturnValue({ forAccount: vi.fn().mockReturnValue(builder) }),
    });
    const out = await createWalletService(server, PASSPHRASE).listIncomingPayments("GME");
    expect(out.items).toEqual([]);
    expect(out.cursor).toBe("c1"); // still scanned, so it is not read again
  });
});

describe("WalletService.activateSponsored", () => {
  // Circle's testnet issuer, the default for USDC off mainnet.
  const ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  const usdcLine = {
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: ISSUER,
    balance: "0.0000000",
  };
  type SubmittedTx = {
    source: string;
    fee: string;
    signatures: unknown[];
    operations: {
      type: string;
      source?: string;
      sponsoredId?: string;
      destination?: string;
      startingBalance?: string;
      line?: { code: string; issuer: string };
    }[];
  };

  /** `walletBalances` is what Horizon holds for the wallet; null when it has no account. */
  async function activate(walletBalances: unknown[] | null) {
    const keys = createWalletService(fakeServer(), PASSPHRASE);
    const sponsor = keys.generate();
    const wallet = keys.generate();
    const submit = vi.fn().mockResolvedValue({ hash: "sponsorhash" });
    const loadAccount = vi.fn(async (id: string) => {
      if (id === wallet.publicKey) {
        if (!walletBalances) throw { name: "NotFoundError", response: { status: 404 } };
        return { balances: walletBalances };
      }
      return {
        accountId: () => sponsor.publicKey,
        sequenceNumber: () => "1",
        incrementSequenceNumber: () => undefined,
      };
    });
    const svc = createWalletService(
      fakeServer({ loadAccount, submitTransaction: submit }),
      PASSPHRASE,
    );
    const res = await svc.activateSponsored({
      sponsorEncryptedSecret: sponsor.encryptedSecret,
      encryptedSecret: wallet.encryptedSecret,
      assets: ["USDC"],
    });
    const tx = submit.mock.calls[0]?.[0] as SubmittedTx | undefined;
    return { res, tx, sponsor: sponsor.publicKey, wallet: wallet.publicKey };
  }

  it("creates the account empty and adds the trustline, all under the sponsor", async () => {
    const { res, tx, sponsor, wallet } = await activate(null);
    expect(res).toEqual({ txHash: "sponsorhash", created: true, trustlines: ["USDC"] });
    // The sponsor is the source, so the fee is the sponsor's too.
    expect(tx!.source).toBe(sponsor);
    expect(tx!.operations.map((op) => op.type)).toEqual([
      "beginSponsoringFutureReserves",
      "createAccount",
      "changeTrust",
      "endSponsoringFutureReserves",
    ]);
    const [begin, create, trust, end] = tx!.operations;
    expect(begin!.sponsoredId).toBe(wallet);
    expect(create!.destination).toBe(wallet);
    // No XLM reaches the wallet: there is nothing for its owner to see or spend.
    expect(Number(create!.startingBalance)).toBe(0);
    expect(trust!.source).toBe(wallet);
    expect(trust!.line).toMatchObject({ code: "USDC", issuer: ISSUER });
    expect(end!.source).toBe(wallet);
    expect(tx!.signatures).toHaveLength(2); // the sponsor and the wallet
  });

  it("sponsors only the trustline when the account already exists", async () => {
    const { res, tx } = await activate([{ asset_type: "native", balance: "5.0000000" }]);
    expect(res).toEqual({ txHash: "sponsorhash", created: false, trustlines: ["USDC"] });
    expect(tx!.operations.map((op) => op.type)).toEqual([
      "beginSponsoringFutureReserves",
      "changeTrust",
      "endSponsoringFutureReserves",
    ]);
  });

  it("sends nothing when the account already holds the trustline", async () => {
    const { res, tx } = await activate([{ asset_type: "native", balance: "5.0000000" }, usdcLine]);
    expect(res).toEqual({ txHash: null, created: false, trustlines: [] });
    expect(tx).toBeUndefined();
  });
});

describe("WalletService.holdsOtherIssuer", () => {
  // Circle's testnet issuer is the default; any other issuer's USDC is a different asset.
  const OURS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  const OTHER = "GCKFBEIYV2U22IO2BJ4KVJOIP7XPWQGQFKKWXR6DOSJBV7STMAQSMTGG";
  const native = { asset_type: "native", balance: "20.0000000" };
  const usdc = (issuer: string, balance: string) => ({
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: issuer,
    balance,
  });
  const holding = (...balances: unknown[]) =>
    createWalletService(
      fakeServer({ loadAccount: vi.fn().mockResolvedValue({ balances }) }),
      PASSPHRASE,
    );

  it("is true when the account holds USDC from an issuer that is not ours", async () => {
    const svc = holding(native, usdc(OTHER, "20.0000000"));
    expect(await svc.holdsOtherIssuer("GABC", "USDC")).toBe(true);
  });

  it("is true even when the account also holds ours", async () => {
    const svc = holding(native, usdc(OURS, "0.5000000"), usdc(OTHER, "20.0000000"));
    expect(await svc.holdsOtherIssuer("GABC", "USDC")).toBe(true);
  });

  it("is false when the only USDC is ours", async () => {
    const svc = holding(native, usdc(OURS, "50.0000000"));
    expect(await svc.holdsOtherIssuer("GABC", "USDC")).toBe(false);
  });

  it("is false for an empty trustline to another issuer: nothing is held", async () => {
    const svc = holding(native, usdc(OTHER, "0.0000000"));
    expect(await svc.holdsOtherIssuer("GABC", "USDC")).toBe(false);
  });

  it("is false for XLM, which has no issuer, without asking Horizon", async () => {
    const loadAccount = vi.fn();
    const svc = createWalletService(fakeServer({ loadAccount }), PASSPHRASE);
    expect(await svc.holdsOtherIssuer("GABC", "XLM")).toBe(false);
    expect(loadAccount).not.toHaveBeenCalled();
  });

  it("is false for an account that does not exist yet", async () => {
    const svc = createWalletService(
      fakeServer({
        loadAccount: vi
          .fn()
          .mockRejectedValue({ name: "NotFoundError", response: { status: 404 } }),
      }),
      PASSPHRASE,
    );
    expect(await svc.holdsOtherIssuer("GABC", "USDC")).toBe(false);
  });
});
