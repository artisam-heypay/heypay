import Link from "next/link";
import { requireRole } from "@/server/auth/sessions";
import { listMerchantTransactions, requireMerchant } from "@/server/merchant/service";
import { txQuerySchema } from "@/lib/schemas/merchant";
import { TransactionsTable } from "@/components/merchant/TransactionsTable";
import { TransactionFilters } from "@/components/merchant/TransactionFilters";

export default async function MerchantTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireRole("MERCHANT");
  const merchant = await requireMerchant(user.id);
  const sp = await searchParams;
  const q = txQuerySchema.parse({
    status: sp.status,
    from: sp.from,
    to: sp.to,
    cursor: sp.cursor,
    limit: 25,
  });
  const page = await listMerchantTransactions(merchant.id, q);

  const nextParams = new URLSearchParams();
  if (sp.status) nextParams.set("status", sp.status);
  if (sp.from) nextParams.set("from", sp.from);
  if (sp.to) nextParams.set("to", sp.to);
  if (page.nextCursor) nextParams.set("cursor", page.nextCursor);

  return (
    <div className="flex flex-col gap-stack-lg">
      <h1 className="text-headline-lg-mobile lg:text-headline-lg">Settlement history</h1>
      <TransactionFilters status={sp.status} from={sp.from} to={sp.to} />
      <TransactionsTable items={page.items} />
      {page.nextCursor && (
        <Link
          href={`/merchant/transactions?${nextParams.toString()}`}
          className="self-center rounded-full border-2 border-primary px-stack-lg py-stack-sm text-body-md text-primary"
        >
          Load more
        </Link>
      )}
    </div>
  );
}
