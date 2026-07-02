import { NextResponse } from "next/server";
import { route, parseQuery } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { txQuerySchema } from "@/lib/schemas/merchant";
import { allMerchantTransactions, getMerchantForUser } from "@/server/merchant/service";
import { toCsv } from "@/lib/csv";

export const GET = route(async (req) => {
  const user = await requireRole("MERCHANT");
  const merchant = await getMerchantForUser(user.id);
  const { status, from, to } = parseQuery(req, txQuerySchema);
  const rows = await allMerchantTransactions(merchant.id, { status, from, to });

  const csv = toCsv(
    ["Reference", "Customer", "Received XLM", "Amount PHP", "Settled PHP", "Status", "Date"],
    rows.map((r) => [
      r.reference,
      r.customer,
      r.amountXlm,
      r.amountPhp,
      r.netSettledPhp,
      r.status,
      r.createdAt,
    ]),
  );
  const filename = `heypay-settlements-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
});
