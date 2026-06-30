import "server-only";
import { Role } from "@/generated/prisma";
import { requireRole } from "@/server/auth/sessions";
import { getPayerPayments } from "@/server/payer/data";
import { TransactionList } from "@/components/payer/TransactionList";
import { loadMorePayerPayments } from "./actions";

export default async function TransactionsPage() {
  const user = await requireRole(Role.PAYER);
  const { items, nextCursor } = await getPayerPayments(user.id, { limit: 20 });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-stack-lg">
      <h1 className="text-headline-lg font-display font-bold">Transactions</h1>
      <TransactionList initial={items} nextCursor={nextCursor} loadMore={loadMorePayerPayments} />
    </div>
  );
}
