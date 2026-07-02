import { route, json } from "@/lib/http";
import { requireRole } from "@/server/auth/sessions";
import { getOverview } from "@/server/admin/overview";
import { displayXlm, displayPhp } from "@/lib/money";

export const GET = route(async () => {
  await requireRole("ADMIN");
  const o = await getOverview();
  return json({
    counts: o.counts,
    volume: {
      totalXlm: o.volume.totalXlm.toFixed(7),
      totalPhpSettled: o.volume.totalPhpSettled.toFixed(2),
      displayXlm: displayXlm(o.volume.totalXlm),
      displayPhp: displayPhp(o.volume.totalPhpSettled),
    },
    recentFailures: o.recentFailures.map((f) => ({
      id: f.id,
      reference: f.reference,
      merchantName: f.merchantName,
      amountPhp: f.amountPhp.toFixed(2),
      failureReason: f.failureReason,
      createdAt: f.createdAt.toISOString(),
    })),
  });
});
