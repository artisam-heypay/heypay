// src/app/api/wallet/external/route.ts
//
// The payer's own wallet: what it holds (GET), connect it (PUT), switch between
// it and the custodial wallet (PATCH), disconnect it (DELETE). Not there at all
// while NONCUSTODIAL_ENABLED is off.
import type { NextRequest } from "next/server";
import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { notFound } from "@/lib/errors";
import { requireRole, type SessionUser } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { rateLimit } from "@/server/auth/rate-limit";
import { captureException } from "@/server/observability/error-tracking";
import { getOwnWalletHoldings, holdingsSnapshot } from "@/server/payer/holdings";
import {
  connectOwnWallet,
  disconnectOwnWallet,
  getOwnWallet,
  nonCustodialEnabled,
  setWalletMode,
} from "@/server/wallet/external";

const connectSchema = z.object({ publicKey: z.string().trim().min(1).max(100) });
const modeSchema = z.object({ walletMode: z.enum(["CUSTODIAL", "EXTERNAL"]) });

async function payer(req: NextRequest): Promise<{ user: SessionUser; ip?: string }> {
  if (!nonCustodialEnabled()) throw notFound();
  assertSameOrigin(req);
  const user = await requireRole("PAYER");
  await rateLimit(`wallet-external:user:${user.id}`, { limit: 10, windowSec: 60 });
  return { user, ip: req.headers.get("x-forwarded-for") ?? undefined };
}

// What the connected account holds, read from the chain: HeyPay keeps no
// balance for it. `holdings` is null when no account is connected, and when the
// chain cannot be read (`readable: false`), so a page never shows it as empty.
export const GET = route(async () => {
  if (!nonCustodialEnabled()) throw notFound();
  const user = await requireRole("PAYER");
  await rateLimit(`wallet-external-read:user:${user.id}`, { limit: 30, windowSec: 60 });
  const own = await getOwnWallet(user.id);
  if (!own.externalPublicKey) return json({ ...own, holdings: null, readable: true });
  try {
    const holdings = await getOwnWalletHoldings(own.externalPublicKey);
    return json({ ...own, holdings: holdingsSnapshot(holdings), readable: true });
  } catch (err) {
    captureException(err, { source: "wallet.own_holdings", userId: user.id });
    return json({ ...own, holdings: null, readable: false });
  }
});

export const PUT = route(async (req) => {
  const { user, ip } = await payer(req);
  const { publicKey } = await parseBody(req, connectSchema);
  return json(await connectOwnWallet({ userId: user.id, publicKey, ip }));
});

export const PATCH = route(async (req) => {
  const { user, ip } = await payer(req);
  const { walletMode } = await parseBody(req, modeSchema);
  return json(await setWalletMode({ userId: user.id, walletMode, ip }));
});

export const DELETE = route(async (req) => {
  const { user, ip } = await payer(req);
  return json(await disconnectOwnWallet({ userId: user.id, ip }));
});
