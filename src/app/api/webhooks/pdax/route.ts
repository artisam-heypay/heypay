import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/server/db";
import { dec } from "@/lib/money";
import { advanceOnRailCallback } from "@/server/payments/state-machine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  eventId: z.string().min(1),
  type: z.enum(["trade.updated", "cashout.updated"]),
  reference: z.string().min(1),
  status: z.enum(["PENDING", "FILLED", "SETTLED", "FAILED"]),
  feePhp: z.string().optional(),
  netPhp: z.string().optional(),
});

const INVALID = NextResponse.json(
  { error: { code: "WEBHOOK_INVALID", message: "Invalid webhook signature or source" } },
  { status: 401 },
);

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.PDAX_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return constantTimeEqual(signature, expected);
}

function ipAllowed(req: NextRequest): boolean {
  const allow = (process.env.PDAX_WEBHOOK_IP_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length === 0) return true; // optional layer; signature is the primary control
  const clientIp = ((req.headers.get("x-forwarded-for") ?? "").split(",")[0] ?? "").trim();
  return clientIp.length > 0 && allow.includes(clientIp);
}

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  if (!verifySignature(rawBody, req.headers.get("x-pdax-signature")) || !ipAllowed(req)) {
    return INVALID;
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json(
      { error: { code: "WEBHOOK_BAD_BODY", message: "Malformed webhook payload" } },
      { status: 400 },
    );
  }

  const idemKey = `webhook.pdax:${parsed.eventId}`;
  const already = await prisma.idempotencyKey.findUnique({ where: { key: idemKey } });
  if (already) return NextResponse.json({ ok: true, idempotent: true });

  const isTrade = parsed.type === "trade.updated";
  const payment = await prisma.payment.findFirst({
    where: isTrade ? { pdaxTradeRef: parsed.reference } : { pdaxCashoutRef: parsed.reference },
    select: { id: true },
  });

  const expiresAt = new Date(Date.now() + RETENTION_MS);
  if (!payment) {
    await prisma.idempotencyKey.create({
      data: { key: idemKey, scope: "webhook.pdax", expiresAt },
    });
    return NextResponse.json({ ok: true, unmatched: true });
  }

  await advanceOnRailCallback({
    paymentId: payment.id,
    kind: isTrade ? "trade" : "cashout",
    externalRef: parsed.reference,
    state: parsed.status,
    feePhp: parsed.feePhp ? dec(parsed.feePhp) : undefined,
    netPhp: parsed.netPhp ? dec(parsed.netPhp) : undefined,
  });

  await prisma.idempotencyKey.create({ data: { key: idemKey, scope: "webhook.pdax", expiresAt } });
  return NextResponse.json({ ok: true });
}
