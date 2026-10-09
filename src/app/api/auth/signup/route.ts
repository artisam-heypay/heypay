import { route, json, parseBody } from "@/lib/http";
import { clientIp } from "@/lib/net";
import { assertSameOrigin } from "@/server/auth/csrf";
import { signupSchema, startSignup } from "@/server/auth/signup";

// Step one of email sign-up: emails a 6-digit code. No account exists until
// POST /api/auth/signup/verify confirms it.
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const input = await parseBody(req, signupSchema);
  await startSignup(input, { ip: clientIp(req) });
  return json({ pending: true, email: input.email }, 202);
});
