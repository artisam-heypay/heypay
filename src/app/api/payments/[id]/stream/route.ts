// src/app/api/payments/[id]/stream/route.ts
import { requireUser } from "@/server/auth/sessions";
import { db } from "@/server/db";
import { isTerminal } from "@/server/payments/state-machine";

// SSE: emit the payment status until it reaches a terminal state. Polls the DB every 1.5s.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  const user = await requireUser();
  const payment = await db.payment.findUnique({ where: { id }, select: { payerId: true } });
  if (!payment || (payment.payerId !== user.id && user.role !== "ADMIN")) {
    return new Response("event: error\ndata: forbidden\n\n", {
      status: 403,
      headers: { "content-type": "text/event-stream" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let last = "";
      for (let i = 0; i < 120; i++) {
        // ~3 min cap
        const p = await db.payment.findUnique({ where: { id }, select: { status: true } });
        if (!p) break;
        if (p.status !== last) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ status: p.status })}\n\n`));
          last = p.status;
        }
        if (isTerminal(p.status)) break;
        await new Promise((r) => setTimeout(r, 1_500));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
