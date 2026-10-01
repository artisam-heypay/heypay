import type { Role } from "@/generated/prisma/client";

export function dashboardPath(role: Role): "/payer/dashboard" | "/merchant/dashboard" | "/admin" {
  switch (role) {
    case "PAYER":
      return "/payer/dashboard";
    case "MERCHANT":
      return "/merchant/dashboard";
    case "ADMIN":
      return "/admin";
  }
}
