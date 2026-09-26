// src/app/api/webhooks/xendit/route.ts
//
// Xendit payout callbacks (payout.succeeded / payout.failed / ...).
//
// The callback is only a nudge. It names a payout; the settle job then asks
// Xendit for that payout's status and acts on the answer. The body's own status
// is never trusted, so even a forged callback can at most trigger a re-check.
import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/server/db";
import { enqueueSettle } from "@/server/queue/queues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  event: z.string().min(1),
  data: z.object({
    id: z.string().min(1),
    reference_id: z.string().optional(),
  }),
});

const INVALID = NextResponse.json(
  { error: { code: "WEBHOOK_INVALID", message: "Invalid webhook token" } },
  { status: 401 },
);

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Xendit sends the dashboard's verification token in `x-callback-token`. */
function tokenValid(token: string | null): boolean {
  const expected = process.env.XENDIT_CALLBACK_TOKEN;
  if (!expected || !token) return false;
  return constantTimeEqual(token, expected);
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!tokenValid(req.headers.get("x-callback-token"))) return INVALID;

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: { code: "WEBHOOK_BAD_BODY", message: "Malformed webhook payload" } },
      { status: 400 },
    );
  }
  if (!parsed.event.startsWith("payout.")) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  // Xendit retries a callback until it gets a 2xx; process each delivery once.
  const deliveryId = req.headers.get("webhook-id") ?? `${parsed.event}:${parsed.data.id}`;
  const idemKey = `webhook.xendit:${deliveryId}`;
  const already = await prisma.idempotencyKey.findUnique({ where: { key: idemKey } });
  if (already) return NextResponse.json({ ok: true, idempotent: true });

  const payment = await prisma.payment.findFirst({
    where: {
      OR: [
        { payoutRef: parsed.data.id },
        ...(parsed.data.reference_id ? [{ reference: parsed.data.reference_id }] : []),
      ],
    },
    select: { id: true },
  });

  if (payment) await enqueueSettle(payment.id);

  await prisma.idempotencyKey.create({
    data: {
      key: idemKey,
      scope: "webhook.xendit",
      expiresAt: new Date(Date.now() + RETENTION_MS),
    },
  });
  return NextResponse.json({ ok: true, ...(payment ? {} : { unmatched: true }) });
}
