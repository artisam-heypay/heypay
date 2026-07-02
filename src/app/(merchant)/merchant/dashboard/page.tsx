import Link from "next/link";
import { requireRole } from "@/server/auth/sessions";
import {
  requireMerchant,
  getMerchantEarnings,
  listMerchantTransactions,
  serializeMerchant,
} from "@/server/merchant/service";
import { EarningsCards } from "@/components/merchant/EarningsCards";
import { TransactionsTable } from "@/components/merchant/TransactionsTable";
import { BusinessSummaryCard } from "@/components/merchant/BusinessSummaryCard";

export default async function MerchantDashboard() {
  const user = await requireRole("MERCHANT");
  const merchant = await requireMerchant(user.id);
  const [earnings, txPage] = await Promise.all([
    getMerchantEarnings(merchant.id),
    listMerchantTransactions(merchant.id, { limit: 8 }),
  ]);

  const isLive = merchant.status === "ACTIVE";
  const statusLabel = isLive ? "Live" : merchant.status.replace(/_/g, " ").toLowerCase();

  return (
    <div className="flex flex-col gap-stack-lg">
      <div className="flex items-center gap-stack-md">
        <h1 className="text-headline-lg-mobile lg:text-headline-lg">Dashboard</h1>
        <span
          className={`inline-flex items-center gap-stack-sm rounded-full px-stack-md py-1 text-label-md uppercase ${
            isLive
              ? "bg-primary-container text-on-primary-container"
              : "bg-surface-container-high text-on-surface-variant"
          }`}
        >
          <span
            className={`h-2 w-2 rounded-full ${isLive ? "bg-primary" : "bg-outline"}`}
            aria-hidden
          />
          {statusLabel}
        </span>
      </div>
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
