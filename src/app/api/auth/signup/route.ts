import { z } from "zod";
import { route, json, parseBody } from "@/lib/http";
import { conflict } from "@/lib/errors";
import { db } from "@/server/db";
import { clientIp } from "@/lib/net";
import { hashPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { rateLimit } from "@/server/auth/rate-limit";
import { audit } from "@/server/auth/audit";
import { walletService } from "@/server/stellar/wallet";

const signupSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_.]+$/, "Use letters, numbers, dot or underscore"),
  password: z.string().min(8).max(200),
  role: z.enum(["PAYER", "MERCHANT"]),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const ip = clientIp(req);
  const signupLimit = Number(process.env.SIGNUP_RATE_LIMIT ?? "5");
  await rateLimit(`signup:ip:${ip}`, { limit: signupLimit, windowSec: 3600 });

  const { username, password, role } = await parseBody(req, signupSchema);

  const existing = await db.user.findUnique({ where: { username } });
  if (existing) throw conflict("Username is not available");

  const passwordHash = await hashPassword(password);

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { username, passwordHash, role } });
    if (role === "PAYER") {
      const wallet = walletService.generate();
      await tx.custodialWallet.create({
        data: {
          userId: created.id,
          stellarPublicKey: wallet.publicKey,
          encryptedSecret: wallet.encryptedSecret,
          secretKeyVersion: wallet.secretKeyVersion,
        },
      });
    }
    return created;
  });

  await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
  await audit({ actorId: user.id, action: "auth.signup", target: user.id, ip });

  return json({ user: { id: user.id, username: user.username, role: user.role } }, 201);
});
