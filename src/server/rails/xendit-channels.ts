// src/server/rails/xendit-channels.ts
//
// HeyPay's settlement bank codes (src/server/merchant/banks.ts) → Xendit payout
// channel codes, from `GET /payouts_channels?currency=PHP`. GCash and Maya are
// e-wallets: their account number is the registered mobile number.
import "server-only";

const CHANNELS: Readonly<Record<string, string>> = {
  BPI: "PH_BPI",
  BDO: "PH_BDO",
  UBP: "PH_UBP",
  METROBANK: "PH_MET",
  LANDBANK: "PH_LBP",
  PNB: "PH_PNB",
  SECURITYBANK: "PH_SEC",
  CTBC: "PH_CTBC",
  RCBC: "PH_RCBC",
  GCASH: "PH_GCASH",
  MAYA: "PH_PAYMAYA",
};

/** The Xendit channel for a HeyPay bank code, or null when Xendit cannot pay it. */
export function xenditChannelFor(bankCode: string): string | null {
  return CHANNELS[bankCode] ?? null;
}
