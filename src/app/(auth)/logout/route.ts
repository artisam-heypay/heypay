// GET /logout → destroy session then redirect to /login (links can point here safely;
// state change is the session revoke, protected by SameSite=Lax cookie semantics).
import { NextResponse } from "next/server";
import { destroySession } from "@/server/auth/sessions";

export async function GET(req: Request) {
  await destroySession();
  return NextResponse.redirect(new URL("/login", req.url));
}
