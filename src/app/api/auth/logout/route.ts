import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { getSessionUser, destroySession } from "@/server/auth/sessions";
import { assertSameOrigin } from "@/server/auth/csrf";
import { audit } from "@/server/auth/audit";
import { clientIp } from "@/lib/net";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await getSessionUser();
  await destroySession();
  if (user)
    await audit({ actorId: user.id, action: "auth.logout", target: user.id, ip: clientIp(req) });
  return new NextResponse(null, { status: 204 });
});
