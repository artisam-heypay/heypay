import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { Card } from "@/components/ui";
import { getPayerPayments } from "@/server/payer/data";
import { loadMorePayerPayments } from "@/server/payer/actions";
import { TransactionList } from "@/components/payer/TransactionList";

export default async function PayerTransactionsPage() {
  const user = await requireRole(Role.PAYER);
  const { items, nextCursor } = await getPayerPayments(user.id, { limit: 20 });

  return (
    <div className="flex flex-col gap-stack-lg">
      <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">Transactions</h1>
      <Card>
        <TransactionList
          initial={items}
          initialCursor={nextCursor}
          loadMore={loadMorePayerPayments}
        />
      </Card>
    </div>
  );
}
