// src/server/rails/pdax.ts
import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { Decimal, dec, phpToXlm } from "@/lib/money";
import { badRequest, serverError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import type {
  BankPayout,
  PaymentRailProvider,
  PayoutStatus,
  Quote,
  TradeStatus,
} from "@/server/rails/provider";

const QUOTE_TTL_MS = 90_000;

// ---- HMAC request signer (SPEC §7.2) -------------------------------------
export function signRequest(input: {
  method: string;
  path: string;
  body: string;
  timestamp: string;
  accessKey: string;
  secret: string;
}): { "Access-Key": string; "Access-Signature": string } {
  const message = input.timestamp + input.method + input.path + input.body;
  const signature = createHmac("sha256", input.secret).update(message).digest("hex");
  return { "Access-Key": input.accessKey, "Access-Signature": signature };
}

// ---- RFC 6238 TOTP (SHA-1) for crypto withdrawals ------------------------
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw badRequest("invalid base32 in TOTP secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

export function generateTotp(
  secret: string,
  opts: { timestamp?: number; digits?: number; period?: number } = {},
): string {
  const digits = opts.digits ?? 6;
  const period = opts.period ?? 30;
  const timestamp = opts.timestamp ?? Date.now();
  const counter = Math.floor(timestamp / 1000 / period);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

// ---- Response schemas (untrusted) ----------------------------------------
const RateSchema = z.object({
  traded_currency: z.string(),
  settlement_currency: z.string(),
  price: z.string(),
});
const RefSchema = z.object({ reference: z.string().min(1) });
const TradeStatusSchema = z.object({
  status: z.string(),
  settlement_fee: z.string().optional(),
  filled_settlement_amount: z.string().optional(),
});
const PayoutStatusSchema = z.object({ status: z.string(), net_amount: z.string().optional() });

class PdaxHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PdaxHttpError";
  }
}

const isRetryable = (err: unknown): boolean => {
  if (err instanceof PdaxHttpError) return err.status >= 500;
  return true; // network/timeout errors are retryable
};

export type PdaxConfig = {
  baseUrl: string;
  accessKey: string;
  secret: string;
  totpSecret: string;
  fetchImpl: typeof fetch;
  now: () => number;
  retries: number;
  baseMs: number;
  timeoutMs: number;
};

function resolveConfig(overrides: Partial<PdaxConfig>): PdaxConfig {
  return {
    baseUrl:
      overrides.baseUrl ??
      process.env.PDAX_BASE_URL ??
      "https://services-stage.pdax.ph/api/exchange/v1",
    accessKey: overrides.accessKey ?? process.env.PDAX_ACCESS_KEY ?? "",
    secret: overrides.secret ?? process.env.PDAX_SECRET ?? "",
    totpSecret: overrides.totpSecret ?? process.env.PDAX_TOTP_SECRET ?? "",
    fetchImpl: overrides.fetchImpl ?? fetch,
    now: overrides.now ?? Date.now,
    retries: overrides.retries ?? 3,
    baseMs: overrides.baseMs ?? 200,
    timeoutMs: overrides.timeoutMs ?? 10_000,
  };
}

export function createPdaxProvider(overrides: Partial<PdaxConfig> = {}) {
  const cfg = resolveConfig(overrides);

  async function call<S extends z.ZodTypeAny>(
    method: "GET" | "POST",
    path: string,
    schema: S,
    opts: { body?: unknown; otp?: boolean } = {},
  ): Promise<z.infer<S>> {
    const body = opts.body === undefined ? "" : JSON.stringify(opts.body);
    return withRetry(
      async () => {
        const timestamp = String(cfg.now());
        const headers: Record<string, string> = {
          "content-type": "application/json",
          ...signRequest({
            method,
            path,
            body,
            timestamp,
            accessKey: cfg.accessKey,
            secret: cfg.secret,
          }),
          "Access-Timestamp": timestamp,
        };
        if (opts.otp) headers["Access-Otp"] = generateTotp(cfg.totpSecret);
        const res = await cfg.fetchImpl(`${cfg.baseUrl}${path}`, {
          method,
          headers,
          body: method === "POST" ? body : undefined,
        });
        if (!res.ok) throw new PdaxHttpError(res.status, `PDAX ${method} ${path} -> ${res.status}`);
        const json: unknown = await res.json();
        const parsed = schema.safeParse(json);
        if (!parsed.success) throw serverError("invalid PDAX response shape");
        return parsed.data;
      },
      { retries: cfg.retries, baseMs: cfg.baseMs, timeoutMs: cfg.timeoutMs, isRetryable },
    );
  }

  const mapTradeState = (s: string): TradeStatus["state"] => {
    const u = s.toUpperCase();
    if (u === "FILLED" || u === "SETTLED" || u === "COMPLETED") return "FILLED";
    if (u === "FAILED" || u === "CANCELLED" || u === "REJECTED") return "FAILED";
    return "PENDING";
  };
  const mapPayoutState = (s: string): PayoutStatus["state"] => {
    const u = s.toUpperCase();
    if (u === "SETTLED" || u === "COMPLETED") return "SETTLED";
    if (u === "FAILED" || u === "CANCELLED" || u === "REJECTED") return "FAILED";
    return "PENDING";
  };

  const provider: PaymentRailProvider & {
    withdrawCryptoForRefund(input: {
      ref: string;
      xlmAmount: Decimal;
      destination: string;
    }): Promise<{ withdrawRef: string }>;
  } = {
    async getQuote({ phpAmount }): Promise<Quote> {
      const r = await call("GET", "/rates/XLMPHP", RateSchema);
      const rate = dec(r.price);
      return {
        rate,
        phpAmount,
        xlmAmount: phpToXlm(phpAmount, rate),
        expiresAt: new Date(cfg.now() + QUOTE_TTL_MS),
      };
    },

    async sellCryptoForPhp({ ref, xlmAmount }) {
      const r = await call("POST", "/trades", RefSchema, {
        body: {
          traded_currency: "XLM",
          settlement_currency: "PHP",
          side: "sell",
          traded_amount: xlmAmount.toFixed(7),
          client_ref: ref,
        },
      });
      return { tradeRef: r.reference };
    },

    async getTradeStatus(tradeRef) {
      const r = await call("GET", `/trades/${encodeURIComponent(tradeRef)}`, TradeStatusSchema);
      const status: TradeStatus = { state: mapTradeState(r.status) };
      if (r.settlement_fee !== undefined) status.feePhp = dec(r.settlement_fee);
      if (r.filled_settlement_amount !== undefined)
        status.filledPhp = dec(r.filled_settlement_amount);
      return status;
    },

    async cashOutPhpToBank({
      ref,
      phpAmount,
      bank,
    }: {
      ref: string;
      phpAmount: Decimal;
      bank: BankPayout;
    }) {
      const r = await call("POST", "/cash_out", RefSchema, {
        body: {
          currency: "PHP",
          amount: phpAmount.toFixed(2),
          bank_code: bank.bankCode,
          account_name: bank.accountName,
          account_number: bank.accountNumber,
          client_ref: ref,
        },
        // PHP cash-out requires NO OTP (SPEC §7.2)
      });
      return { payoutRef: r.reference };
    },

    async getPayoutStatus(payoutRef) {
      const r = await call("GET", `/cash_out/${encodeURIComponent(payoutRef)}`, PayoutStatusSchema);
      const status: PayoutStatus = { state: mapPayoutState(r.status) };
      if (r.net_amount !== undefined) status.netPhp = dec(r.net_amount);
      return status;
    },

    async withdrawCryptoForRefund({ ref, xlmAmount, destination }) {
      // Crypto-out (refund path) REQUIRES an OTP (TOTP) — SPEC §7.2 / AGENT §6.
      const r = await call("POST", "/crypto_withdrawals", RefSchema, {
        body: {
          currency: "XLM",
          amount: xlmAmount.toFixed(7),
          address: destination,
          client_ref: ref,
        },
        otp: true,
      });
      return { withdrawRef: r.reference };
    },
  };

  return provider;
}

export const pdaxProvider = createPdaxProvider();
