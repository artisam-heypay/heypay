// What the swap API accepts and returns, shared by the routes and the swap screen.
import { z } from "zod";

/** A positive Stellar amount: up to 7 decimal places, as a string. */
export const swapAmountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,7})?$/, "Enter an amount with up to 7 decimal places.")
  .refine((v) => Number(v) > 0, "Enter an amount above zero.");

export const swapAssetSchema = z.enum(["XLM", "USDC"]);

export type SwapQuoteResponse = {
  from: string;
  to: string;
  /** strict_send spends exactly `amount`; strict_receive receives exactly `minReceived`. */
  mode: "strict_send" | "strict_receive";
  amount: string;
  estimated: string;
  minReceived: string;
};

export type SwapResponse = {
  txHash: string;
  txUrl: string;
  from: string;
  to: string;
  sent: string;
  received: string;
};
