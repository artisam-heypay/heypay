// src/app/api/wallet/deposit-address/route.ts
import QRCode from "qrcode";
import { z } from "zod";
import { route, json, parseQuery } from "@/lib/http";
import { requireUser } from "@/server/auth/sessions";
import { db } from "@/server/db";
import { assertAssetEnabled, isIssuedAsset } from "@/lib/assets";
import { assetIssuer } from "@/server/stellar/assets";
import { notFound } from "@/lib/errors";
import { walletService } from "@/server/stellar/wallet";

const querySchema = z.object({ asset: z.enum(["XLM", "USDC", "USDT"]).default("XLM") });

export const GET = route(async (req) => {
  const user = await requireUser();
  const { asset } = parseQuery(req, querySchema);
  assertAssetEnabled(asset);

  const wallet = await db.custodialWallet.findUnique({ where: { userId: user.id } });
  if (!wallet) throw notFound("wallet not found");

  // Chain truth, not the cached flag: if the configured issuer changes, the
  // cache says "can receive" about a trustline to the old issuer, and handing
  // out the address on that basis produces op_no_trust for the sender.
  const canReceive = await walletService.canReceive(wallet.stellarPublicKey, asset);
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
    canReceive,
  });
});
