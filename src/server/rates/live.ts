// src/server/rates/live.ts
//
// Live asset→PHP prices for quoting.
//
// Primary: the Coins.ph order book *bid* — the price someone will actually pay
// for the asset in PHP right now. HeyPay receives the payer's crypto and has to
// sell it later, so pricing at the bid means a merchant is never paid more PHP
// than the crypto can realistically fetch.
//
// Backup: CoinMarketCap's aggregated price, used when Coins.ph is unavailable.
// When both answer, they must agree within `maxDivergenceBps`; a wider gap means
// one of them is wrong, and quoting a payment on a wrong price is worse than
// refusing it.
import "server-only";
import { z } from "zod";
import { dec, type Decimal } from "@/lib/money";
import type { PaymentAsset } from "@/lib/assets";
import { AppError } from "@/lib/errors";
import { withTimeout } from "@/lib/retry";

export type RateSource = "COINSPH" | "CMC";
export type LiveRate = { asset: PaymentAsset; rate: Decimal; source: RateSource };

const COINSPH_URL = "https://api.pro.coins.ph/openapi/quote/v1/ticker/bookTicker";
const CMC_URL = "https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest";

const bookTickerSchema = z.object({ symbol: z.string(), bidPrice: z.string() });
const cmcSchema = z.object({
  status: z.object({ error_code: z.number() }),
  data: z.record(
    z.array(z.object({ quote: z.object({ PHP: z.object({ price: z.number() }) }) })).min(1),
  ),
});

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

function unavailable(message: string, details?: unknown): AppError {
  return new AppError("RATE_UNAVAILABLE", message, 503, details);
}

function positive(value: Decimal, what: string): Decimal {
  if (!value.isFinite() || value.lessThanOrEqualTo(0)) throw new Error(`${what} is not positive`);
  return value;
}

export function createLiveRates(
  opts: {
    fetchImpl?: FetchImpl;
    cmcApiKey?: string;
    maxDivergenceBps?: number;
    timeoutMs?: number;
    /** How long a CoinMarketCap answer is reused, to stay inside the plan's credit limit. */
    cmcCacheMs?: number;
    now?: () => number;
  } = {},
) {
  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const cmcApiKey = opts.cmcApiKey ?? process.env.CMC_API_KEY?.trim() ?? "";
  const maxDivergence = dec(
    opts.maxDivergenceBps ?? Number(process.env.RATE_MAX_DIVERGENCE_BPS ?? 200),
  ).div(10_000);
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const cmcCacheMs = opts.cmcCacheMs ?? Number(process.env.CMC_CACHE_MS ?? 60_000);
  const now = opts.now ?? Date.now;
  const cmcCache = new Map<PaymentAsset, { rate: Decimal; at: number }>();

  async function getJson(url: string, init?: RequestInit): Promise<unknown> {
    const res = await withTimeout(fetchImpl(url, init), timeoutMs);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function coinsPhBid(asset: PaymentAsset): Promise<Decimal> {
    const body = bookTickerSchema.parse(await getJson(`${COINSPH_URL}?symbol=${asset}PHP`));
    return positive(dec(body.bidPrice), "Coins.ph bid");
  }

  async function cmcPrice(asset: PaymentAsset): Promise<Decimal> {
    const cached = cmcCache.get(asset);
    if (cached && now() - cached.at < cmcCacheMs) return cached.rate;
    const body = cmcSchema.parse(
      await getJson(`${CMC_URL}?symbol=${asset}&convert=PHP`, {
        headers: { "X-CMC_PRO_API_KEY": cmcApiKey, Accept: "application/json" },
      }),
    );
    if (body.status.error_code !== 0)
      throw new Error(`CoinMarketCap error ${body.status.error_code}`);
    const entry = body.data[asset]?.[0];
    if (!entry) throw new Error(`CoinMarketCap has no ${asset} quote`);
    const rate = positive(dec(entry.quote.PHP.price), "CoinMarketCap price");
    cmcCache.set(asset, { rate, at: now() });
    return rate;
  }

  async function attempt(fn: () => Promise<Decimal>): Promise<Decimal | null> {
    try {
      return await fn();
    } catch (err) {
      console.error("[rates] source failed", (err as Error).message);
      return null;
    }
  }

  return {
    /** The asset's PHP price: Coins.ph bid, else CoinMarketCap. Throws when neither can be trusted. */
    async getRate(asset: PaymentAsset): Promise<LiveRate> {
      const [primary, backup] = await Promise.all([
        attempt(() => coinsPhBid(asset)),
        cmcApiKey ? attempt(() => cmcPrice(asset)) : Promise.resolve(null),
      ]);

      if (primary && backup) {
        const gap = primary.minus(backup).abs().div(backup);
        if (gap.greaterThan(maxDivergence)) {
          throw unavailable(
            `Live ${asset} prices disagree right now, so no quote can be given. Try again shortly.`,
            { asset, coinsph: primary.toString(), cmc: backup.toString() },
          );
        }
      }
      if (primary) return { asset, rate: primary, source: "COINSPH" };
      if (backup) return { asset, rate: backup, source: "CMC" };
      throw unavailable(`No live ${asset} price is available right now. Try again shortly.`, {
        asset,
      });
    },
  };
}

export type LiveRates = ReturnType<typeof createLiveRates>;

let singleton: LiveRates | null = null;

/** Process-wide instance, so the CoinMarketCap cache is shared. */
export function liveRates(): LiveRates {
  singleton ??= createLiveRates();
  return singleton;
}
