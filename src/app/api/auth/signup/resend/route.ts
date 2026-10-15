import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { clientIp } from "@/lib/net";
import { assertSameOrigin } from "@/server/auth/csrf";
import { resendSignupCode } from "@/server/auth/signup";

// Emails a fresh code for the sign-up this browser started.
export const POST = route(async (req) => {
  assertSameOrigin(req);
  await resendSignupCode({ ip: clientIp(req) });
  return new NextResponse(null, { status: 204 });
});
