import { db } from "@/server/db";

// Truncate auth-related tables between tests. Child tables first / CASCADE handles FKs.
export async function resetDb(): Promise<void> {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog","Session","CustodialWallet","User" RESTART IDENTITY CASCADE',
  );
}
