import "server-only";
import { prisma } from "@/server/db";

// AGENT §5: in production the seeded admin must change their password before using the console.
// Derived from AuditLog (no schema change). Disabled outside production.
export async function adminMustChangePassword(userId: string): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return false;
  const changed = await prisma.auditLog.findFirst({
    where: { actorId: userId, action: "auth.password.change" },
    select: { id: true },
  });
  return changed === null;
}
