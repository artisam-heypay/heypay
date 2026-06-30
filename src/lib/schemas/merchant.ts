import { z } from "zod";
import { SUPPORTED_BANKS } from "@/server/merchant/banks";

const BANK_CODES = SUPPORTED_BANKS.map((b) => b.code) as [string, ...string[]];
const STATUSES = [
  "CREATED",
  "QUOTED",
  "AUTHORIZED",
  "STELLAR_SUBMITTED",
  "STELLAR_CONFIRMED",
  "PDAX_TRADING",
  "PDAX_TRADED",
  "PAYOUT_SUBMITTED",
  "SETTLED",
  "FAILED",
  "REFUND_PENDING",
  "REFUNDED",
] as const;

export const createMerchantSchema = z.object({
  businessName: z.string().trim().min(2).max(120),
});

export const patchMerchantSchema = z
  .object({
    businessName: z.string().trim().min(2).max(120).optional(),
    logoKey: z.string().trim().min(1).max(256).optional(),
  })
  .refine((v) => v.businessName !== undefined || v.logoKey !== undefined, {
    message: "No fields to update",
  });

export const settlementSchema = z.object({
  bankCode: z.enum(BANK_CODES),
  accountName: z.string().trim().min(2).max(120),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{6,20}$/, "6–20 digits"),
});

export const qrphSchema = z.object({
  raw: z.string().trim().min(20).max(1024),
  imageKey: z.string().trim().min(1).max(256).optional(),
});

export const txQuerySchema = z.object({
  status: z.enum(STATUSES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateMerchantInput = z.infer<typeof createMerchantSchema>;
export type PatchMerchantInput = z.infer<typeof patchMerchantSchema>;
export type SettlementInput = z.infer<typeof settlementSchema>;
export type QrphInput = z.infer<typeof qrphSchema>;
export type TxQuery = z.infer<typeof txQuerySchema>;
