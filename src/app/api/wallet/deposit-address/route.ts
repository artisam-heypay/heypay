// src/app/api/wallet/deposit-address/route.ts
import QRCode from "qrcode";
import { z } from "zod";
import { route, json, parseQuery } from "@/lib/http";
import { requireUser } from "@/server/auth/sessions";
import { db } from "@/server/db";
import { assertAssetEnabled, isIssuedAsset } from "@/lib/assets";
import { assetIssuer } from "@/server/stellar/assets";
import { notFound } from "@/lib/errors";
import { getAssetBalance } from "@/server/wallet/balances";

const querySchema = z.object({ asset: z.enum(["XLM", "USDC", "USDT"]).default("XLM") });

export const GET = route(async (req) => {
  const user = await requireUser();
  const { asset } = parseQuery(req, querySchema);
  assertAssetEnabled(asset);

  const wallet = await db.custodialWallet.findUnique({ where: { userId: user.id } });
  if (!wallet) throw notFound("wallet not found");

  const balance = await getAssetBalance(db, wallet.id, asset);
  const qrSvg = await QRCode.toString(wallet.stellarPublicKey, { type: "svg", margin: 1 });

  return json({
    publicKey: wallet.stellarPublicKey,
    qrSvg,
    network: "stellar",
    memoRequired: false,
    asset,
    // The address is the same for every asset; what differs is whether the
    // account is allowed to receive it yet.
    issuer: assetIssuer(asset),
    trustlineRequired: isIssuedAsset(asset),
    canReceive: balance.canReceive,
  });
});
