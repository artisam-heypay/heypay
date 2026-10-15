import { requireRole } from "@/server/auth/sessions";
import { Role } from "@/generated/prisma/client";
import { Card } from "@/components/ui";
import { getPayerPayments } from "@/server/payer/data";
import { getPayerSwaps, swapsAvailable } from "@/server/payer/swap";
import { loadMorePayerPayments, loadMorePayerSwaps } from "@/server/payer/actions";
import { TransactionList } from "@/components/payer/TransactionList";
import { SwapList } from "@/components/payer/SwapList";

export default async function PayerTransactionsPage() {
  const user = await requireRole(Role.PAYER);
  const [{ items, nextCursor }, swaps] = await Promise.all([
    getPayerPayments(user.id, { limit: 20 }),
    getPayerSwaps(user.id, { limit: 20 }),
  ]);
  // Swaps made while they were on stay in the history after they are turned off.
  const showSwaps = swaps.items.length > 0 || swapsAvailable();

  return (
    <div className="flex flex-col gap-stack-lg">
      <h1 className="font-display text-headline-lg-mobile lg:text-headline-lg">Transactions</h1>
      <Card className="flex flex-col gap-stack-md">
        {showSwaps && <h2 className="font-display text-headline-md">Payments</h2>}
        <div>
          <TransactionList
            initial={items}
            initialCursor={nextCursor}
            loadMore={loadMorePayerPayments}
          />
        </div>
      </Card>
      {showSwaps && (
        <Card className="flex flex-col gap-stack-md">
          <h2 className="font-display text-headline-md">Swaps</h2>
          <div>
            <SwapList
              initial={swaps.items}
              initialCursor={swaps.nextCursor}
              loadMore={loadMorePayerSwaps}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
