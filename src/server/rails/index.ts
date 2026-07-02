// src/server/rails/index.ts
import "server-only";
import type { PaymentRailProvider } from "@/server/rails/provider";
import { mockProvider } from "@/server/rails/mock";
import { pdaxProvider } from "@/server/rails/pdax";

export function selectRail(name?: string): PaymentRailProvider {
  return name === "pdax" ? pdaxProvider : mockProvider;
}

export const rail: PaymentRailProvider = selectRail(process.env.PAYMENT_RAIL);

export type { PaymentRailProvider } from "@/server/rails/provider";
