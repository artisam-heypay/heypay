import { route, json, parseBody } from "@/lib/http";
import { clientIp } from "@/lib/net";
import { assertSameOrigin } from "@/server/auth/csrf";
import { signupCodeSchema, verifySignup } from "@/server/auth/signup";

// Step two of email sign-up: the emailed code creates the account and signs it in.
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const { code } = await parseBody(req, signupCodeSchema);
  const user = await verifySignup(code, {
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return json({ user: { id: user.id, username: user.username, role: user.role } }, 201);
});
