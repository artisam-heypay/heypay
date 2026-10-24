// Two requests that read the same payment and then both try to move it. The
// second must be refused, not overwrite the first: a cancel that lands just as
// a signed deposit is accepted (or just as the settle job sends a custodial
// one) must not mark a paid payment FAILED.
//
// The race is made deterministic with a row lock held from a second database
// connection: the cancel route reads the payment, then waits on the lock while
// "the other request" moves the payment and commits.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import pg from "pg";
import { resetDb, makePayer, makeMerchant } from "../helpers/db";
import { db } from "@/server/db";
import { newPaymentReference } from "@/server/payments/reference";
import type { PaymentStatus } from "@/generated/prisma/client";

const { sessionUser } = vi.hoisted(() => ({
  sessionUser: {
    current: null as null | { id: string; username: string; role: "PAYER"; isActive: boolean },
  },
}));
vi.mock("@/server/auth/sessions", () => ({
  requireRole: vi.fn(async () => sessionUser.current),
}));

import { POST as cancel } from "@/app/api/payments/[id]/cancel/route";
import { applyTransition } from "@/server/payments/state-machine";

const sameOrigin = { origin: "http://localhost", "sec-fetch-site": "same-origin" };

function postCancel(paymentId: string) {
  return cancel(
    new NextRequest(`http://localhost/api/payments/${paymentId}/cancel`, {
      method: "POST",
      headers: sameOrigin,
    }),
    { params: Promise.resolve({ id: paymentId }) },
  );
}

async function makePayment(status: PaymentStatus, opts?: { reservedXlm?: string }) {
  const { user, wallet } = await makePayer({ reservedXlm: opts?.reservedXlm });
  const { merchant } = await makeMerchant();
  const payment = await db.payment.create({
    data: {
      reference: newPaymentReference(),
      payerId: user.id,
      merchantId: merchant.id,
      amountPhp: "100.00",
      quotedRate: "12.00000000",
      amountAsset: "8.3333334",
      networkFeeXlm: "0.0000100",
      status,
      quoteExpiresAt: new Date(Date.now() + 60_000),
    },
  });
  sessionUser.current = { id: user.id, username: user.username, role: "PAYER", isActive: true };
  return { user, wallet, payment };
}

// `locker` holds the row; `watcher` looks for the blocked cancel. The watcher
// must be its own connection: inside the locker's transaction Postgres keeps
// one snapshot of pg_stat_activity, so a cancel that blocks after the first
// look would never be seen from there.
let locker: pg.Client;
let watcher: pg.Client;

beforeEach(async () => {
  await resetDb();
  locker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  watcher = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await Promise.all([locker.connect(), watcher.connect()]);
});

afterEach(async () => {
  await locker.query("ROLLBACK").catch(() => {});
  await Promise.all([locker.end(), watcher.end()]);
  sessionUser.current = null;
});

/** Waits until some statement on the Payment table is blocked behind the lock. */
async function untilBlocked() {
  for (let i = 0; i < 100; i++) {
    const { rows } = await watcher.query(
      `select count(*)::int as n from pg_stat_activity
        where wait_event_type = 'Lock' and query ilike '%"Payment"%'`,
    );
    if (rows[0].n > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("the cancel never reached the locked row");
}

describe("a cancel racing another request on the same payment", () => {
  it("is refused when a signed deposit was accepted after the cancel read the payment", async () => {
    const { payment } = await makePayment("QUOTED");
    await locker.query("BEGIN");
    await locker.query(`select id from "Payment" where id = $1 for update`, [payment.id]);

    const pending = postCancel(payment.id);
    await untilBlocked();
    // What /signed does: claim the quote with the deposit's hash and move it on.
    await locker.query(
      `update "Payment" set status = 'AUTHORIZED', "stellarTxHash" = 'ab12', "externalPublicKey" = 'GOWN'
        where id = $1`,
      [payment.id],
    );
    await locker.query("COMMIT");

    const res = await pending;
    expect(res.status).toBe(409);
    expect((await res.json()).error.details).toMatchObject({ reason: "status_changed" });
    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("AUTHORIZED");
    expect(after.failureReason).toBeNull();
    expect(await db.paymentEvent.count({ where: { paymentId: payment.id } })).toBe(0);
  });

  it("keeps the HeyPay wallet's hold when the settle job sent the payment first", async () => {
    const { wallet, payment } = await makePayment("AUTHORIZED", { reservedXlm: "8.3333434" });
    await locker.query("BEGIN");
    await locker.query(`select id from "Payment" where id = $1 for update`, [payment.id]);

    const pending = postCancel(payment.id);
    await untilBlocked();
    // What the settle job does: send the custodial payment and record it.
    await locker.query(
      `update "Payment" set status = 'STELLAR_SUBMITTED', "stellarTxHash" = 'cd34' where id = $1`,
      [payment.id],
    );
    await locker.query("COMMIT");

    const res = await pending;
    expect(res.status).toBe(409);
    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("STELLAR_SUBMITTED");
    // The release of the hold was rolled back with the refused cancel.
    const w = await db.custodialWallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(w.reservedXlm.toFixed(7)).toBe("8.3333434");
  });

  it("still cancels a payment nobody else is moving", async () => {
    const { payment } = await makePayment("QUOTED");
    const res = await postCancel(payment.id);
    expect(res.status).toBe(200);
    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("CANCELLED");
  });
});

describe("applyTransition", () => {
  it("refuses to move a payment from a status it is no longer in, and records nothing", async () => {
    const { payment } = await makePayment("QUOTED");
    const read = { id: payment.id, status: payment.status };
    await applyTransition(db, read, "AUTHORIZED");

    await expect(applyTransition(db, read, "FAILED")).rejects.toMatchObject({
      status: 409,
      details: { reason: "status_changed", expected: "QUOTED" },
    });
    const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("AUTHORIZED");
    const events = await db.paymentEvent.findMany({ where: { paymentId: payment.id } });
    expect(events.map((e) => `${e.fromStatus}->${e.toStatus}`)).toEqual(["QUOTED->AUTHORIZED"]);
  });
});
