// src/app/api/wallet/deposit-address/route.ts
import QRCode from "qrcode";
import { route, json } from "@/lib/http";
import { requireUser } from "@/server/auth/sessions";
import { db } from "@/server/db";
import { notFound } from "@/lib/errors";

export const GET = route(async () => {
  const user = await requireUser();
  const wallet = await db.custodialWallet.findUnique({ where: { userId: user.id } });
  if (!wallet) throw notFound("wallet not found");
  const qrSvg = await QRCode.toString(wallet.stellarPublicKey, { type: "svg", margin: 1 });
  return json({
    publicKey: wallet.stellarPublicKey,
    qrSvg,
    network: "stellar",
    memoRequired: false,
  });
});
