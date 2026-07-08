// src/server/rails/index.ts
import "server-only";
import type { PaymentRailProvider } from "@/server/rails/provider";
import { mockProvider } from "@/server/rails/mock";
import { pdaxProvider } from "@/server/rails/pdax";
import { pdaxInstiProvider } from "@/server/rails/pdax-insti";

// Values pasted into deploy dashboards can arrive wrapped in quotes or with stray
// whitespace; a strict match would silently fall back to mock, so normalize first.
function normalizeRailName(name?: string): string {
  return (name ?? "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .toLowerCase();
}

export function selectRail(name?: string): PaymentRailProvider {
  const n = normalizeRailName(name);
  if (n === "pdax") return pdaxProvider;
  if (n === "pdax-insti") return pdaxInstiProvider;
  return mockProvider;
}

export const rail: PaymentRailProvider = selectRail(process.env.PAYMENT_RAIL);

{
  const n = normalizeRailName(process.env.PAYMENT_RAIL);
  const selected = n === "pdax" || n === "pdax-insti" ? n : "mock";
  console.log(
    `[rails] PAYMENT_RAIL=${JSON.stringify(process.env.PAYMENT_RAIL ?? null)} -> ${selected}`,
  );
}

export type { PaymentRailProvider } from "@/server/rails/provider";
