import { NextResponse } from "next/server";
import { route, parseQuery } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { txQuerySchema } from "@/lib/schemas/merchant";
import { allMerchantTransactions, getMerchantForUser } from "@/server/merchant/service";
import { toCsv } from "@/lib/csv";
import { captureUserEvent } from "@/server/observability/analytics";

export const GET = route(async (req) => {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUser(user.id);
  const { status, from, to } = parseQuery(req, txQuerySchema);
  const rows = await allMerchantTransactions(merchant.id, { status, from, to });

  const csv = toCsv(
    [
      "Reference",
      "Customer",
      "Asset",
      "Amount Received",
      "Amount PHP",
      "Settled PHP",
      "Status",
      "Date",
    ],
    rows.map((r) => [
      r.reference,
      r.customer,
      r.asset,
      r.amountAsset,
      r.amountPhp,
      r.netSettledPhp,
      r.status,
      r.createdAt,
    ]),
  );
  captureUserEvent("merchant_transactions_exported", user, {
    merchant_id: merchant.id,
    rows: rows.length,
    status_filter: status ?? null,
    has_date_range: Boolean(from || to),
  });
  const filename = `heypay-settlements-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
});
