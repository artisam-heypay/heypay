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
    expect(out.items[0]!.amountXlm.equals(new Decimal("10.0"))).toBe(true);
    expect(out.items[1]!.txHash).toBe("h3");
    expect(out.items[1]!.amountXlm.equals(new Decimal("1.0"))).toBe(true);
    expect(out.items[1]!.from).toBe("GX");
    expect(out.cursor).toBe("c3"); // advances past every scanned record
    expect(builder.cursor).toHaveBeenCalledWith("c0");
  });
});
