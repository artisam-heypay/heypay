// src/server/rails/pdax-insti.ts
//
// PDAX Institution API provider (hackathon). Unlike the HMAC-signed exchange API
// in pdax.ts, this API authenticates via POST /login -> short-lived JWT pair
// (access_token + id_token headers, 10-minute TTL). Docs: doc.general.api.pdax.ph
// The UAT environment (uat.services.sandbox.pdax.ph) does NOT enforce IP
// whitelisting; Stage/Prod do.
import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Decimal, dec, phpToXlm } from "@/lib/money";
import { AppError, badRequest, serverError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import type {
  BankPayout,
  PaymentRailProvider,
  PayoutStatus,
  Quote,
  TradeStatus,
} from "@/server/rails/provider";

const QUOTE_TTL_MS = 90_000;
// Refresh JWTs when less than this remains (tokens live 600s).
const TOKEN_SLACK_MS = 60_000;
// PDAX OTC enforces a 0.5-XLM quantity step for XLM sell orders. Quantities that
// aren't a whole multiple of 0.5 are rejected with "Invalid Quantity Step"
// (e.g. 13.7 fails, 27.5 is accepted).
const XLM_QTY_STEP = dec("0.5");

// PDAX fiat-withdraw bank codes (docs "Bank Code" section). Merchant records
// store human codes like "BPI"; unknown codes pass through unchanged.
// NOTE (hackathon UAT): per the APAC Stellar playbook Appendix D, the sandbox
// only COMPLETES payouts to two whitelisted bank+account combos —
// Security Bank BASECPH acct 0000042001461, CTBC BACTBPH acct 001700062270.
// Every other bank/e-wallet auto-declines (PRC003/005/008), verified 2026-07-03.
const BANK_CODE_MAP: Record<string, string> = {
  BPI: "BABOTPH",
  BDO: "BABDOPH",
  UNIONBANK: "BAUBPPH",
  UBP: "BAUBPPH",
  METROBANK: "BAMBAPH",
  LANDBANK: "BALABPH",
  MAYA: "EWPAYPH",
  GCASH: "EWGXCPH",
  SECURITYBANK: "BASECPH",
  CTBC: "BACTBPH",
};

// ---- response schemas (untrusted) -----------------------------------------
const LoginSchema = z.object({
  access_token: z.string().min(1),
  id_token: z.string().min(1),
  expiry: z.number(),
});
const PriceV2Schema = z.object({
  data: z.object({ price: z.number(), base_quantity: z.number() }),
});
const FirmQuoteSchema = z.object({
  data: z.object({ quote_id: z.string().min(1), expires_at: z.string() }),
});
const OrderSchema = z.object({
  data: z.object({ order_id: z.number(), status: z.string() }),
});
const OrderStatusSchema = z.object({
  data: z.object({ status: z.string(), total_amount: z.number() }),
});
const WithdrawSchema = z.object({
  data: z.object({ identifier: z.string(), status: z.string(), fee: z.number() }),
});
const FiatTxSchema = z.object({
  data: z.array(
    z.object({
      status: z.string(),
      amount: z.string(),
      fee: z.string(),
      declined_at: z.string().nullable(),
      rejection_reason: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
});

// UAT's instapay channel takes ~8-15s to decline (PRC003); with the default
// 20s grace, settle-on-accept waits out that window so sandbox declines still
// surface as FAILED. Set PDAX_INSTI_PAYOUT_GRACE_MS=0 (demo only) to settle as
// soon as PDAX accepts — required for non-UnionBank banks in UAT, where every
// InstaPay payout auto-declines regardless of account validity.
const DEFAULT_PAYOUT_GRACE_MS = 20_000;

class PdaxInstiHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PdaxInstiHttpError";
  }
}

// PDAX returns some permanent client errors (e.g. below-minimum quantity) with
// HTTP 500 — retrying those only burns 35s of backoff before failing anyway.
const PERMANENT_ERROR_RE =
  /below IMM minimum|minimum required quantity|maximum required quantity|Invalid Quantity Step|Invalid Price Step/i;

const isRetryable = (err: unknown): boolean => {
  if (err instanceof AppError) return false; // mapped permanent errors
  if (err instanceof PdaxInstiHttpError) return err.status >= 500 || err.status === 401;
  return true; // network/timeout
};

export type PdaxInstiConfig = {
  baseUrl: string;
  username: string;
  password: string;
  /**
   * Settle as soon as PDAX ACCEPTS the payout (async-rail semantics: InstaPay/
   * PESONet cash-outs complete out-of-band, and PDAX UAT's instapay channel
   * auto-declines (PRC003) while its UnionBank channel sits IN-PROGRESS
   * indefinitely — per PDAX support, a known partner outage). A payout that
   * PDAX has already DECLINED still fails even with this flag on. Set false
   * to require status COMPLETED before settling.
   */
  settleOnSubmit: boolean;
  /**
   * How long an accepted payout must sit in-flight before settleOnSubmit
   * settles it. The default (20s) outlasts UAT's ~8-15s instapay auto-decline
   * so declines still surface as FAILED; 0 settles on first poll (demo only —
   * UAT declines every non-UnionBank payout regardless of account validity).
   */
  payoutGraceMs: number;
  fetchImpl: typeof fetch;
  now: () => number;
};

function resolveConfig(overrides: Partial<PdaxInstiConfig>): PdaxInstiConfig {
  return {
    baseUrl:
      overrides.baseUrl ??
      process.env.PDAX_INSTI_BASE_URL ??
      "https://uat.services.sandbox.pdax.ph/api/pdax-api",
    username: overrides.username ?? process.env.PDAX_INSTI_USERNAME ?? "",
    password: overrides.password ?? process.env.PDAX_INSTI_PASSWORD ?? "",
    settleOnSubmit: overrides.settleOnSubmit ?? process.env.PDAX_INSTI_SETTLE_ON_SUBMIT === "true",
    payoutGraceMs:
      overrides.payoutGraceMs ??
      (process.env.PDAX_INSTI_PAYOUT_GRACE_MS !== undefined
        ? Number(process.env.PDAX_INSTI_PAYOUT_GRACE_MS)
        : DEFAULT_PAYOUT_GRACE_MS),
    fetchImpl: overrides.fetchImpl ?? fetch,
    now: overrides.now ?? Date.now,
  };
}

export function createPdaxInstiProvider(
  overrides: Partial<PdaxInstiConfig> = {},
): PaymentRailProvider {
  const cfg = resolveConfig(overrides);

  let tokens: { accessToken: string; idToken: string; expiresAtMs: number } | null = null;

  async function ensureTokens(): Promise<{ accessToken: string; idToken: string }> {
    if (tokens && tokens.expiresAtMs - cfg.now() > TOKEN_SLACK_MS) return tokens;
    const res = await cfg.fetchImpl(`${cfg.baseUrl}/pdax-institution/v1/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: cfg.username, password: cfg.password }),
    });
    if (!res.ok) throw new PdaxInstiHttpError(res.status, `PDAX login -> ${res.status}`);
    const parsed = LoginSchema.safeParse(await res.json());
    if (!parsed.success) throw serverError("invalid PDAX login response shape");
    tokens = {
      accessToken: parsed.data.access_token,
      idToken: parsed.data.id_token,
      expiresAtMs: cfg.now() + parsed.data.expiry * 1000,
    };
    return tokens;
  }

  async function call<S extends z.ZodTypeAny>(
    method: "GET" | "POST",
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<z.infer<S>> {
    return withRetry(
      async () => {
        const { accessToken, idToken } = await ensureTokens();
        const res = await cfg.fetchImpl(`${cfg.baseUrl}${path}`, {
          method,
          headers: {
            "content-type": "application/json",
            access_token: accessToken,
            id_token: idToken,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!res.ok) {
          if (res.status === 401) tokens = null; // force re-login on retry
          const text = await res.text().catch(() => "");
          if (PERMANENT_ERROR_RE.test(text)) {
            let msg = text.slice(0, 300);
            try {
              msg = (JSON.parse(text) as { message?: string }).message ?? msg;
            } catch {
              // keep raw text
            }
            throw badRequest(`PDAX: ${msg}`);
          }
          throw new PdaxInstiHttpError(
            res.status,
            `PDAX ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`,
          );
        }
        const parsed = schema.safeParse(await res.json());
        if (!parsed.success) throw serverError(`invalid PDAX response shape for ${path}`);
        return parsed.data;
      },
      { isRetryable, label: `pdax-insti ${method} ${path}` },
    );
  }

  return {
    async getQuote({ phpAmount }): Promise<Quote> {
      const qs = new URLSearchParams({
        side: "sell",
        quote_currency: "XLM",
        base_currency: "PHP",
        currency: "PHP",
        quantity: phpAmount.toFixed(2),
      });
      const r = await call("GET", `/pdax-institution/v2/trade/price?${qs}`, PriceV2Schema);
      const rate = dec(String(r.data.price));
      return {
        rate,
        phpAmount,
        xlmAmount: phpToXlm(phpAmount, rate),
        expiresAt: new Date(cfg.now() + QUOTE_TTL_MS),
      };
    },

    async sellCryptoForPhp({ xlmAmount }) {
      // PDAX enforces a 0.5-XLM quantity step, so round DOWN to the nearest 0.5
      // (the sub-step remainder stays in the PDAX balance rather than
      // over-selling what was debited).
      const qty = xlmAmount.dividedToIntegerBy(XLM_QTY_STEP).times(XLM_QTY_STEP);
      const q = await call("POST", "/pdax-institution/v1/trade/quote", FirmQuoteSchema, {
        quote_currency: "XLM",
        base_currency: "PHP",
        side: "sell",
        base_quantity: qty.toString(),
      });
      // Firm quotes expire in 15s; accept immediately.
      const o = await call("POST", "/pdax-institution/v1/trade", OrderSchema, {
        quote_id: q.data.quote_id,
        side: "sell",
        idempotency_id: randomUUID(),
      });
      return { tradeRef: String(o.data.order_id) };
    },

    async getTradeStatus(tradeRef): Promise<TradeStatus> {
      const r = await call(
        "GET",
        `/pdax-institution/v1/orders/${encodeURIComponent(tradeRef)}`,
        OrderStatusSchema,
      );
      const s = r.data.status.toUpperCase();
      if (s === "SUCCESSFUL") {
        return { state: "FILLED", filledPhp: dec(String(r.data.total_amount)), feePhp: dec("0") };
      }
      if (s === "FAILED") return { state: "FAILED" };
      return { state: "PENDING" };
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
      const names = bank.accountName.trim().split(/\s+/);
      const bankCode = BANK_CODE_MAP[bank.bankCode.toUpperCase()] ?? bank.bankCode;
      try {
        const r = await call("POST", "/pdax-institution/v1/fiat/withdraw", WithdrawSchema, {
          identifier: ref,
          sender_first_name: "HeyPay",
          sender_middle_name: "n.a.",
          sender_last_name: "Operations",
          sender_country_origin: "Philippines",
          source_of_funds: "Others: Sample",
          beneficiary_first_name: names[0] ?? "n.a.",
          beneficiary_middle_name: "n.a.",
          beneficiary_last_name: names.length > 1 ? names[names.length - 1]! : (names[0] ?? "n.a."),
          beneficiary_bank_code: bankCode,
          beneficiary_account_name: bank.accountName,
          beneficiary_account_number: bank.accountNumber,
          purpose: "Family Support",
          relationship_of_sender_to_beneficiary: "Myself",
          currency: "PHP",
          amount: phpAmount.toFixed(2),
          method: "PAY-TO-ACCOUNT-NON-REAL-TIME",
        });
        return { payoutRef: r.data.identifier };
      } catch (err) {
        // Idempotency: PDAX rejects duplicate identifiers; a retry after a
        // successful submit should resolve to the same payout reference.
        if (err instanceof PdaxInstiHttpError && /already existing/i.test(err.message)) {
          return { payoutRef: ref };
        }
        throw err;
      }
    },

    async getPayoutStatus(payoutRef): Promise<PayoutStatus> {
      const qs = new URLSearchParams({
        identifier: payoutRef,
        mode: "CashOut",
        page: "1",
        pageSize: "10",
      });
      const r = await call("GET", `/pdax-institution/v1/fiat/transactions?${qs}`, FiatTxSchema);
      const tx = r.data[0];
      if (!tx) return { state: "PENDING" }; // not yet visible
      const feePhp = dec(tx.fee);
      const netPhp = dec(tx.amount).minus(feePhp);
      const s = tx.status.toUpperCase();
      // A decline is terminal regardless of mode.
      if (s === "FAILED" || s === "REJECTED" || s === "DECLINED" || tx.declined_at) {
        return { state: "FAILED" };
      }
      if (s === "COMPLETED") return { state: "SETTLED", netPhp, feePhp };
      // Accepted and in flight (PENDING / IN-PROGRESS): settle only after the
      // decline window has passed, so sandbox declines still surface as FAILED.
      const ageMs = cfg.now() - Date.parse(tx.created_at);
      if (cfg.settleOnSubmit && ageMs >= cfg.payoutGraceMs) {
        return { state: "SETTLED", netPhp, feePhp };
      }
      return { state: "PENDING" };
    },
  };
}

export const pdaxInstiProvider: PaymentRailProvider = createPdaxInstiProvider();
