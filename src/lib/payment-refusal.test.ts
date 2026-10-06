import { describe, expect, it } from "vitest";
import { readRefusal, refusalMessage } from "./payment-refusal";

describe("refusalMessage", () => {
  it("tells the payer what is wrong and what to do next", () => {
    expect(refusalMessage({ reason: "payer_no_trustline", asset: "USDC" })).toBe(
      "Turn on USDC first.",
    );
    expect(refusalMessage({ reason: "asset_mismatch", asset: "USDC", payWith: "XLM" })).toBe(
      "This shop is paid in a different currency. Pay with XLM instead.",
    );
    expect(refusalMessage({ reason: "insufficient_balance", asset: "USDC", payWith: "XLM" })).toBe(
      "Not enough USDC — add more or pay with XLM.",
    );
    expect(refusalMessage({ reason: "insufficient_fee", asset: "USDC", feeXlm: "0.21" })).toBe(
      "Not enough XLM for the network fee — add about 0.21 XLM.",
    );
  });

  it("tells a payer whose own asset is the wrong one why it is not taken", () => {
    expect(
      refusalMessage({
        reason: "asset_mismatch",
        asset: "USDC",
        cause: "payer_issuer",
        payWith: "XLM",
      }),
    ).toBe(
      "Your USDC is from a different issuer than the one HeyPay accepts, so it can't be used here. Pay with XLM instead.",
    );
    // A mismatch on HeyPay's side is not blamed on the payer's asset.
    for (const cause of ["escrow", "destination"] as const) {
      expect(
        refusalMessage({ reason: "asset_mismatch", asset: "USDC", cause, payWith: "XLM" }),
      ).toBe("This shop is paid in a different currency. Pay with XLM instead.");
    }
  });

  it("names no other asset when there is none to pay with", () => {
    expect(refusalMessage({ reason: "asset_mismatch", asset: "XLM" })).toBe(
      "This shop is paid in a different currency.",
    );
    expect(refusalMessage({ reason: "insufficient_balance", asset: "XLM" })).toBe(
      "Not enough XLM — add more.",
    );
  });
});

describe("readRefusal", () => {
  it("reads the reason and the asset from an error body", () => {
    const body = {
      error: {
        code: "CONFLICT",
        message: "Not enough USDC — add more or pay with XLM.",
        details: { reason: "insufficient_balance", asset: "USDC", payWith: "XLM" },
      },
    };
    expect(readRefusal(body, "fallback")).toEqual({
      message: "Not enough USDC — add more or pay with XLM.",
      refusal: { reason: "insufficient_balance", asset: "USDC", payWith: "XLM" },
    });
  });

  it("keeps the message of an error that is not one of the known refusals", () => {
    const body = {
      error: { message: "quote expired; please re-quote", details: { reason: "no_escrow" } },
    };
    expect(readRefusal(body, "fallback")).toEqual({
      message: "quote expired; please re-quote",
      refusal: null,
    });
  });

  it("falls back when the body is missing or not an error", () => {
    expect(readRefusal(null, "Could not quote in USDC.")).toEqual({
      message: "Could not quote in USDC.",
      refusal: null,
    });
    expect(readRefusal({ ok: true }, "fallback").message).toBe("fallback");
  });
});
