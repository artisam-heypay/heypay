// src/app/api/wallet/trustline/route.ts
//
// Establishes the payer wallet's trustline to an issued asset's issuer. Until
// this succeeds the wallet cannot receive that asset at all — Stellar rejects
// the incoming payment rather than holding it.
import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { rateLimit } from "@/server/auth/rate-limit";
import { db } from "@/server/db";
import { dec } from "@/lib/money";
import { assertAssetEnabled, isIssuedAsset } from "@/lib/assets";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { walletService } from "@/server/stellar/wallet";
import { TRUSTLINE_XLM_REQUIREMENT } from "@/server/stellar/assets";
import { getAssetBalance, markTrustlineEstablished } from "@/server/wallet/balances";

const bodySchema = z.object({ asset: z.enum(["XLM", "USDC", "USDT"]) });

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireRole("PAYER");
  await rateLimit(`trustline:user:${user.id}`, { limit: 5, windowSec: 60 });
  const { asset } = await parseBody(req, bodySchema);

  assertAssetEnabled(asset);
  if (!isIssuedAsset(asset)) {
    throw badRequest(`${asset} is the native asset and needs no trustline.`, { asset });
  }

  const wallet = await db.custodialWallet.findUnique({ where: { userId: user.id } });
  if (!wallet) throw notFound("wallet not found");

  // Each trustline raises the account's minimum XLM reserve, and the changeTrust
  // transaction costs a fee — an unfunded account simply cannot add one.
  const xlm = await getAssetBalance(db, wallet.id, "XLM");
  const required = dec(TRUSTLINE_XLM_REQUIREMENT);
  if (xlm.available.lessThan(required)) {
    throw conflict(`Fund your wallet with at least ${required.toFixed(1)} XLM first.`, {
      availableXlm: xlm.available.toFixed(7),
      requiredXlm: required.toFixed(7),
    });
  }

  const result = await walletService.establishTrustline({
    encryptedSecret: wallet.encryptedSecret,
    asset,
  });
  await markTrustlineEstablished(wallet.id, asset);

  return json({
    asset,
    txHash: result.txHash,
    alreadyEstablished: result.alreadyEstablished,
    canReceive: true,
  });
});
