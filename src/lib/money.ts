import { Decimal } from "decimal.js";

// Global precision headroom; rounding is applied explicitly per-format.
Decimal.set({ precision: 40 });

export { Decimal };

/** Construct a Decimal from any source; throws on NaN/Infinity. */
export function dec(value: string | number | Decimal): Decimal {
  const d = value instanceof Decimal ? value : new Decimal(value);
  if (!d.isFinite()) throw new Error(`Invalid monetary value: ${String(value)}`);
  return d;
}

/** Format XLM with exactly 7 dp (string), half-up. e.g. "12.5000000" */
export function formatXlm(value: Decimal): string {
  return dec(value).toDecimalPlaces(7, Decimal.ROUND_HALF_UP).toFixed(7);
}

/** Format PHP with exactly 2 dp (string), half-up. e.g. "1234.50" */
export function formatPhp(value: Decimal): string {
  return dec(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** "1234.50" -> "1,234.50"; the sign stays in front. */
function groupThousands(fixed: string): string {
  const negative = fixed.startsWith("-");
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [intPart = "", frac = ""] = unsigned.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${frac}`;
}

/** Display helper: "₱1,234.50" (grouped, 2dp). */
export function displayPhp(value: Decimal): string {
  const grouped = groupThousands(formatPhp(value));
  return grouped.startsWith("-") ? `-₱${grouped.slice(1)}` : `₱${grouped}`;
}

/** Display helper: "12.5000000 XLM" (7dp). */
export function displayXlm(value: Decimal): string {
  return `${formatXlm(value)} XLM`;
}

// Every Stellar asset — native and issued alike — is stored with 7 decimal places
// (amounts are int64 stroops), so one formatter covers XLM, USDC and USDT.
/** Format any Stellar asset amount with exactly 7 dp, half-up. */
export const formatAsset = formatXlm;

/** Display helper: "12.5000000 USDT". */
export function displayAsset(value: Decimal, asset: string): string {
  return `${formatAsset(value)} ${asset}`;
}

/** Display helper for a total read at a glance: "1,294.29 XLM" (grouped, 2dp). */
export function displayAssetTotal(value: Decimal, asset: string): string {
  return `${groupThousands(formatPhp(value))} ${asset}`;
}

/** Quote math: phpAmount / rate -> asset units needed (7dp, ROUND_UP so payer always covers). */
export function phpToAsset(phpAmount: Decimal, rate: Decimal): Decimal {
  const php = dec(phpAmount);
  const r = dec(rate);
  if (r.lte(0)) throw new Error("Rate must be a positive number");
  return php.div(r).toDecimalPlaces(7, Decimal.ROUND_UP);
}

/** Back-compat alias of {@link phpToAsset} for the XLM leg. */
export const phpToXlm = phpToAsset;

/** available = cached - reserved (any asset) */
export function availableAmount(cached: Decimal, reserved: Decimal): Decimal {
  return dec(cached).minus(dec(reserved));
}

/** Back-compat alias of {@link availableAmount} for the XLM leg. */
export const availableXlm = availableAmount;
