// src/server/rails/index.ts
import "server-only";
import type { PaymentRailProvider } from "@/server/rails/provider";
import { mockProvider } from "@/server/rails/mock";
import { xenditProvider } from "@/server/rails/xendit";
import { isMainnet } from "@/server/stellar/horizon";

// Values pasted into deploy dashboards can arrive wrapped in quotes or with stray
// whitespace; a strict match would silently fall back to mock, so normalize first.
function normalizeRailName(name?: string): string {
  return (name ?? "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .toLowerCase();
}

export function selectRail(name?: string): PaymentRailProvider {
  return normalizeRailName(name) === "xendit" ? xenditProvider : mockProvider;
}

export const rail: PaymentRailProvider = selectRail(process.env.PAYMENT_RAIL);

/**
 * Whether a payout counts as settled as soon as Xendit accepts it, instead of
 * after the minutes Xendit's test simulator takes to report SUCCEEDED. Only on
 * a Xendit test key off mainnet, where no real money moves and every valid
 * payout succeeds. PAYOUT_FAST_SETTLE=false turns it off.
 */
export function fastSettleEnabled(): boolean {
  if (normalizeRailName(process.env.PAYOUT_FAST_SETTLE) === "false") return false;
  if (normalizeRailName(process.env.PAYMENT_RAIL) !== "xendit") return false;
  if (isMainnet()) return false;
  return (process.env.XENDIT_SECRET_KEY ?? "").trim().startsWith("xnd_development_");
}

{
  const selected = normalizeRailName(process.env.PAYMENT_RAIL) === "xendit" ? "xendit" : "mock";
  console.log(
    `[rails] PAYMENT_RAIL=${JSON.stringify(process.env.PAYMENT_RAIL ?? null)} -> ${selected}` +
      `, fast settle ${fastSettleEnabled() ? "on" : "off"}`,
  );
}

export type { PaymentRailProvider } from "@/server/rails/provider";
