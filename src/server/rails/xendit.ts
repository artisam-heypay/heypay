// src/server/rails/xendit.ts
//
// Settlement rail over Xendit Payouts (v2).
//
// The payer's crypto goes to the HeyPay treasury on Stellar; the merchant is paid
// PHP from HeyPay's Xendit balance. Xendit emails its own "Disbursement Receipt"
// to the merchant's payout email (and HeyPay ops, cc) when a payout succeeds —
// proof of payment that HeyPay neither writes nor can alter.
//
// Payouts settle in minutes, not seconds, so nothing here waits for one: the
// settle job submits it, and the Xendit webhook (or the reconcile job) reports
// back. Server-side only; the secret key never reaches a client.
import "server-only";
import { z } from "zod";
import { dec, phpToAsset } from "@/lib/money";
import { withRetry } from "@/lib/retry";
import { liveRates, type LiveRates } from "@/server/rates/live";
import { xenditChannelFor } from "@/server/rails/xendit-channels";
import {
  treasuryAddress,
  type PaymentRailProvider,
  type PayoutStatus,
  type Quote,
  type RailPayload,
} from "@/server/rails/provider";

const API_BASE = "https://api.xendit.co";
const QUOTE_TTL_MS = 90_000;

const payoutSchema = z
  .object({
    id: z.string().min(1),
    status: z.string(),
    amount: z.number().optional(),
    failure_code: z.string().nullish(),
  })
  .passthrough();

/** Xendit refused the request itself (4xx): retrying the same call cannot help. */
export class XenditRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "XenditRequestError";
  }
}

const isRetryable = (err: unknown): boolean => !(err instanceof XenditRequestError);

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

/** Xendit status → rail state. Anything not yet final is PENDING. */
function toPayoutStatus(p: z.infer<typeof payoutSchema>): PayoutStatus {
  const common = { railStatus: p.status, raw: p as RailPayload };
  switch (p.status) {
    case "SUCCEEDED":
      return {
        ...common,
        state: "SETTLED",
        netPhp: p.amount !== undefined ? dec(p.amount) : undefined,
      };
    case "FAILED":
    case "CANCELLED":
    case "REVERSED":
      return { ...common, state: "FAILED", failureCode: p.failure_code ?? p.status };
    default:
      return { ...common, state: "PENDING" }; // ACCEPTED, REQUESTED, LOCKED, ...
  }
}

/**
 * Who gets Xendit's payout receipt: the merchant, with HeyPay cc'd. A merchant
 * without a payout email must not cost HeyPay its own copy, so HeyPay's
 * addresses become the recipients instead.
 */
function receiptNotification(
  merchantEmail: string | null,
  heypay: string[],
): { receipt_notification?: { email_to: string[]; email_cc?: string[] } } {
  if (merchantEmail) {
    return {
      receipt_notification: {
        email_to: [merchantEmail],
        ...(heypay.length > 0 ? { email_cc: heypay } : {}),
      },
    };
  }
  return heypay.length > 0 ? { receipt_notification: { email_to: heypay } } : {};
}

export function createXenditProvider(
  opts: {
    secretKey?: string;
    fetchImpl?: FetchImpl;
    rates?: LiveRates;
    receiptCc?: string;
    retries?: number;
  } = {},
): PaymentRailProvider {
  const secretKey = () => opts.secretKey ?? process.env.XENDIT_SECRET_KEY?.trim() ?? "";
  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const rates = () => opts.rates ?? liveRates();
  const receiptCc = () =>
    (opts.receiptCc ?? process.env.XENDIT_RECEIPT_CC ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3); // Xendit accepts at most three addresses per field
  const retries = opts.retries ?? 3;

  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    const key = secretKey();
    if (!key) throw new Error("XENDIT_SECRET_KEY is not set");
    const res = await fetchImpl(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    const text = await res.text();
    if (res.status >= 400 && res.status < 500) {
      throw new XenditRequestError(res.status, `Xendit ${path} rejected (${res.status}): ${text}`);
    }
    if (!res.ok) throw new Error(`Xendit ${path} failed (${res.status})`);
    return JSON.parse(text);
  }

  return {
    // Every enabled asset is collected into the treasury as-is; PAYMENT_ASSETS
    // is what narrows the set.
    supportsAsset: () => true,

    getDepositAddress() {
      const address = treasuryAddress();
      if (!address) {
        return Promise.reject(new Error("HEYPAY_TREASURY_PUBLIC_KEY is not set"));
      }
      return Promise.resolve({ address, memo: null });
    },

    async getQuote({ sell, phpAmount }): Promise<Quote> {
      const { rate, source } = await rates().getRate(sell);
      return {
        asset: sell,
        rate,
        phpAmount,
        assetAmount: phpToAsset(phpAmount, rate),
        expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
        source,
      };
    },

    async createPayout({ ref, phpAmount, bank, receiptEmail }) {
      const channelCode = xenditChannelFor(bank.bankCode);
      if (!channelCode) throw new Error(`Xendit cannot pay out to bank code ${bank.bankCode}`);
      const cc = receiptCc();
      const body = {
        reference_id: ref,
        channel_code: channelCode,
        channel_properties: {
          account_number: bank.accountNumber,
          account_holder_name: bank.accountName,
        },
        amount: Number(phpAmount.toFixed(2)),
        currency: "PHP",
        description: `HeyPay payment ${ref}`,
        ...receiptNotification(receiptEmail, cc),
      };
      const created = await withRetry(
        async () =>
          payoutSchema.parse(
            await call("/v2/payouts", {
              method: "POST",
              // Same key on every retry: Xendit returns the original payout
              // instead of paying the merchant a second time.
              headers: { "Idempotency-key": ref },
              body: JSON.stringify(body),
            }),
          ),
        { label: "xendit.createPayout", retries, isRetryable },
      );
      return { payoutRef: created.id, raw: created as RailPayload };
    },

    async getPayoutStatus(payoutRef) {
      const payout = await withRetry(
        async () => payoutSchema.parse(await call(`/v2/payouts/${encodeURIComponent(payoutRef)}`)),
        { label: "xendit.getPayoutStatus", retries, isRetryable },
      );
      return toPayoutStatus(payout);
    },

    async cancelPayout(payoutRef) {
      const path = `/v2/payouts/${encodeURIComponent(payoutRef)}`;
      try {
        await withRetry(async () => call(`${path}/cancel`, { method: "POST" }), {
          label: "xendit.cancelPayout",
          retries,
          isRetryable,
        });
      } catch (err) {
        // Xendit only cancels a payout it has not processed yet; anything else
        // gets a 400 (CANCELLATION_NOT_ALLOWED). The payout's own status below
        // says where it stands either way.
        if (!(err instanceof XenditRequestError)) throw err;
      }
      return this.getPayoutStatus(payoutRef);
    },
  };
}

export const xenditProvider: PaymentRailProvider = createXenditProvider();
