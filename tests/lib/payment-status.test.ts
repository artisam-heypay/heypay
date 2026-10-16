import { describe, expect, it } from "vitest";
import {
  bankRefusedPayout,
  payoutFailedReason,
  statusLabel,
  statusTone,
} from "@/lib/payment-status";
import { PAYMENT_STEPS, stepState } from "@/lib/payment-steps";

describe("statusLabel", () => {
  it("gives every status a payer can see a plain label", () => {
    expect(statusLabel("SETTLED")).toBe("Settled");
    expect(statusLabel("PAYOUT_SUBMITTED")).toBe("Paying Out");
    expect(statusLabel("REFUND_PENDING")).toBe("Refund Pending");
    expect(statusLabel("REFUNDED")).toBe("Refunded");
    expect(statusLabel("FAILED")).toBe("Failed");
  });

  it("shows an unknown status as it is rather than nothing", () => {
    expect(statusLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });
});

describe("statusTone", () => {
  it("colours money that arrived or came back as settled", () => {
    expect(statusTone("SETTLED")).toBe("settled");
    expect(statusTone("REFUNDED")).toBe("settled");
  });

  it("colours a failure, and a refund still owed, as failed", () => {
    expect(statusTone("FAILED")).toBe("failed");
    expect(statusTone("REFUND_PENDING")).toBe("failed");
  });

  it("keeps a payment nobody confirmed neutral, and one in flight pending", () => {
    expect(statusTone("CREATED")).toBe("neutral");
    expect(statusTone("QUOTED")).toBe("neutral");
    for (const s of ["AUTHORIZED", "STELLAR_SUBMITTED", "STELLAR_CONFIRMED", "PAYOUT_SUBMITTED"]) {
      expect(statusTone(s), s).toBe("pending");
    }
  });
});

describe("bankRefusedPayout", () => {
  it("recognises the reason recorded when the shop's bank refuses a payout", () => {
    expect(bankRefusedPayout(payoutFailedReason("disb-1", "INVALID_DESTINATION"))).toBe(true);
    expect(bankRefusedPayout(payoutFailedReason("disb-1", null))).toBe(true);
  });

  it("leaves other reasons alone", () => {
    expect(bankRefusedPayout("stellar tx failed to confirm")).toBe(false);
    expect(bankRefusedPayout("Payout disb-1 failed")).toBe(false);
    expect(bankRefusedPayout(null)).toBe(false);
  });
});

describe("stepState", () => {
  const states = (current: Parameters<typeof stepState>[1]) =>
    PAYMENT_STEPS.map((step) => stepState(step.key, current));

  it("marks the steps behind the current one done, the current one active, the rest to do", () => {
    expect(states("AUTHORIZED")).toEqual(["active", "todo", "todo", "todo", "todo"]);
    expect(states("STELLAR_CONFIRMED")).toEqual(["done", "done", "active", "todo", "todo"]);
    expect(states("PAYOUT_SUBMITTED")).toEqual(["done", "done", "done", "active", "todo"]);
  });

  it("marks every step done once settled, with none left spinning", () => {
    expect(states("SETTLED")).toEqual(["done", "done", "done", "done", "done"]);
  });

  it("keeps only the authorization done when the payment failed or is being refunded", () => {
    for (const status of ["FAILED", "REFUND_PENDING", "REFUNDED"] as const) {
      expect(states(status), status).toEqual(["done", "todo", "todo", "todo", "todo"]);
    }
  });
});
