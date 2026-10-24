import { z } from "zod";
import { SUPPORTED_BANKS } from "@/server/merchant/banks";

const BANK_CODES = SUPPORTED_BANKS.map((b) => b.code) as [string, ...string[]];
const STATUSES = [
  "CREATED",
  "QUOTED",
  "AUTHORIZED",
  "STELLAR_SUBMITTED",
  "STELLAR_CONFIRMED",
  "PAYOUT_SUBMITTED",
  "SETTLED",
  "FAILED",
  "REFUND_PENDING",
  "REFUNDED",
] as const;

// Shown next to the field in the onboarding wizard, so written for the merchant.
const businessName = z
  .string()
  .trim()
  .min(2, "Enter your business name (at least 2 characters)")
  .max(120, "Keep the business name under 120 characters");

export const createMerchantSchema = z.object({
  businessName,
});

export const patchMerchantSchema = z
  .object({
    businessName: businessName.optional(),
    logoKey: z.string().trim().min(1).max(256).optional(),
  })
  .refine((v) => v.businessName !== undefined || v.logoKey !== undefined, {
    message: "No fields to update",
  });

export const settlementSchema = z.object({
  bankCode: z.enum(BANK_CODES, { error: "Choose the bank or e-wallet to be paid into" }),
  accountName: z
    .string()
    .trim()
    .min(2, "Enter the name on the account")
    .max(120, "Keep the account name under 120 characters"),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9]{6,20}$/, "Enter the account or mobile number: 6 to 20 digits"),
  // Receives Xendit's payout receipt for every settled payment.
  payoutEmail: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email, like name@example.com")
    .max(254, "Enter a shorter email"),
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
