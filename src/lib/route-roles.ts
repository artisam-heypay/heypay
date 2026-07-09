import type { Role } from "@/generated/prisma/client";

export type RequiredAccess = "public" | Role;

// Route groups (payer)/(merchant)/(admin) materialize as /payer, /merchant, /admin URL prefixes.
export function requiredRoleForPath(pathname: string): RequiredAccess {
  if (pathname === "/payer" || pathname.startsWith("/payer/")) return "PAYER";
  if (pathname === "/merchant" || pathname.startsWith("/merchant/")) return "MERCHANT";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "ADMIN";
  return "public";
}

export function evaluateAccess(
  pathname: string,
  role: Role | null,
): "allow" | "login" | "forbidden" {
  const required = requiredRoleForPath(pathname);
  if (required === "public") return "allow";
  if (role === null) return "login";
  return role === required ? "allow" : "forbidden";
}
