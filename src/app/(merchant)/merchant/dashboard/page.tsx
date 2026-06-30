import Link from "next/link";
import { Role } from "@/generated/prisma";
import { requireRole } from "@/server/auth/sessions";
import {
  getMerchantForUser,
  getMerchantEarnings,
  listMerchantTransactions,
  serializeMerchant,
} from "@/server/merchant/service";
import { EarningsCards } from "@/components/merchant/EarningsCards";
import { TransactionsTable } from "@/components/merchant/TransactionsTable";
import { BusinessSummaryCard } from "@/components/merchant/BusinessSummaryCard";

export default async function MerchantDashboard() {
  const user = await requireRole(Role.MERCHANT);
  const merchant = await getMerchantForUser(user.id);
  const [earnings, txPage] = await Promise.all([
    getMerchantEarnings(merchant.id),
    listMerchantTransactions(merchant.id, { limit: 8 }),
  ]);

  return (
    <div className="flex flex-col gap-stack-lg">
      <h1 className="text-headline-lg-mobile lg:text-headline-lg">Dashboard</h1>
      <EarningsCards earnings={earnings} />
      <div className="grid grid-cols-1 gap-stack-lg lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="mb-stack-md flex items-center justify-between">
            <h2 className="text-headline-md">Business transactions</h2>
            <Link href="/merchant/transactions" className="text-body-sm text-primary">
              View all
            </Link>
          </div>
          <TransactionsTable items={txPage.items} />
        </section>
        <div className="flex flex-col gap-stack-lg">
          <BusinessSummaryCard merchant={serializeMerchant(merchant)} />
          <div className="tonal-card flex flex-col gap-stack-sm rounded-xl p-stack-lg">
            <div className="flex items-center gap-stack-md">
              <span className="material-symbols-outlined text-primary">support_agent</span>
              <p className="text-headline-md">Need help?</p>
            </div>
            <p className="text-body-sm text-on-surface-variant">
              Our team is here for settlement or QR questions.
            </p>
            <Link href="/merchant/settings" className="text-body-sm font-medium text-primary">
              Contact support
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
