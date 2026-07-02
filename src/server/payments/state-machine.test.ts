import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, makePayer, makeMerchant } from "../../../tests/helpers/db";
import { db } from "@/server/db";
import { PaymentStatus } from "@/generated/prisma/client";
import { newPaymentReference } from "./reference";
import {
  TRANSITIONS,
  TERMINAL,
  XLM_MOVED,
  canTransition,
  isTerminal,
  nextStep,
  applyTransition,
} from "./state-machine";

describe("state machine (pure)", () => {
  it("encodes the authoritative happy path", () => {
    expect(nextStep("CREATED")).toBe("QUOTED");
    expect(nextStep("QUOTED")).toBe("AUTHORIZED");
    expect(nextStep("AUTHORIZED")).toBe("STELLAR_SUBMITTED");
    expect(nextStep("STELLAR_SUBMITTED")).toBe("STELLAR_CONFIRMED");
    expect(nextStep("STELLAR_CONFIRMED")).toBe("PDAX_TRADING");
    expect(nextStep("PDAX_TRADING")).toBe("PDAX_TRADED");
    expect(nextStep("PDAX_TRADED")).toBe("PAYOUT_SUBMITTED");
    expect(nextStep("PAYOUT_SUBMITTED")).toBe("SETTLED");
    expect(nextStep("REFUND_PENDING")).toBe("REFUNDED");
    expect(nextStep("SETTLED")).toBeNull();
  });

  it("allows legal transitions and rejects illegal ones", () => {
    expect(canTransition("QUOTED", "AUTHORIZED")).toBe(true);
    expect(canTransition("AUTHORIZED", "STELLAR_SUBMITTED")).toBe(true);
    expect(canTransition("QUOTED", "SETTLED")).toBe(false);
    expect(canTransition("CREATED", "AUTHORIZED")).toBe(false);
    expect(canTransition("SETTLED", "REFUNDED")).toBe(false);
  });

  it("permits the refund branch only once XLM has moved", () => {
    expect(XLM_MOVED.has("STELLAR_CONFIRMED")).toBe(true);
    expect(canTransition("STELLAR_CONFIRMED", "REFUND_PENDING")).toBe(true);
    expect(canTransition("PDAX_TRADED", "REFUND_PENDING")).toBe(true);
    expect(canTransition("PAYOUT_SUBMITTED", "REFUND_PENDING")).toBe(true);
    expect(canTransition("REFUND_PENDING", "REFUNDED")).toBe(true);
    expect(canTransition("AUTHORIZED", "REFUND_PENDING")).toBe(false);
    expect(canTransition("AUTHORIZED", "FAILED")).toBe(true);
  });

  it("marks terminal states", () => {
    expect([...TERMINAL].sort()).toEqual(["FAILED", "REFUNDED", "SETTLED"]);
    expect(isTerminal("SETTLED")).toBe(true);
    expect(isTerminal("PDAX_TRADING")).toBe(false);
  });

  it("every status appears as a key in TRANSITIONS", () => {
    for (const s of Object.values(PaymentStatus)) {
      expect(TRANSITIONS).toHaveProperty(s);
    }
  });
});

describe("applyTransition (persisted)", () => {
  beforeEach(resetDb);

  async function makeQuoted() {
    const { user } = await makePayer();
    const { merchant } = await makeMerchant();
    return db.payment.create({
      data: {
        reference: newPaymentReference(),
        payerId: user.id,
        merchantId: merchant.id,
        amountPhp: "100.00",
        quotedRate: "12.00000000",
        amountXlm: "8.3333334",
        networkFeeXlm: "0.0000100",
        status: "QUOTED",
        quoteExpiresAt: new Date(Date.now() + 90_000),
      },
    });
  }

  it("persists a legal transition and writes a PaymentEvent", async () => {
    const p = await makeQuoted();
    const updated = await applyTransition(db, p, "AUTHORIZED", { reservedXlm: "8.3333434" });
    expect(updated.status).toBe("AUTHORIZED");
    const events = await db.paymentEvent.findMany({ where: { paymentId: p.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: "QUOTED", toStatus: "AUTHORIZED" });
  });

  it("throws conflict (409) on an illegal transition and writes no event", async () => {
    const p = await makeQuoted();
    await expect(applyTransition(db, p, "SETTLED")).rejects.toMatchObject({ status: 409 });
    expect(await db.paymentEvent.count({ where: { paymentId: p.id } })).toBe(0);
  });
});
