import "server-only";
import { prisma } from "@/server/db";
import { dec, Decimal } from "@/lib/money";

export type AdminOverview = {
  counts: {
    users: number;
    payers: number;
    merchants: number;
    activeMerchants: number;
    payments: number;
    settledPayments: number;
    failedPayments: number;
  };
  volume: { totalXlm: Decimal; totalPhpSettled: Decimal };
  recentFailures: Array<{
    id: string;
    reference: string;
    merchantName: string;
    amountPhp: Decimal;
    failureReason: string | null;
    createdAt: Date;
  }>;
};

export async function getOverview(): Promise<AdminOverview> {
  const [
    users,
    payers,
    merchants,
    activeMerchants,
    payments,
    settledPayments,
    failedPayments,
    settledAgg,
    failures,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: "PAYER" } }),
    prisma.merchant.count(),
    prisma.merchant.count({ where: { status: "ACTIVE" } }),
    prisma.payment.count(),
    prisma.payment.count({ where: { status: "SETTLED" } }),
    prisma.payment.count({ where: { status: "FAILED" } }),
    prisma.payment.aggregate({
      where: { status: "SETTLED" },
      _sum: { amountXlm: true, netSettledPhp: true },
    }),
    prisma.payment.findMany({
      where: { status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { merchant: { select: { businessName: true } } },
    }),
  ]);

  return {
    counts: {
      users,
      payers,
      merchants,
      activeMerchants,
      payments,
      settledPayments,
      failedPayments,
    },
    volume: {
      totalXlm: dec(settledAgg._sum.amountXlm?.toString() ?? "0"),
      totalPhpSettled: dec(settledAgg._sum.netSettledPhp?.toString() ?? "0"),
    },
    recentFailures: failures.map((p) => ({
      id: p.id,
      reference: p.reference,
      merchantName: p.merchant.businessName,
      amountPhp: dec(p.amountPhp.toString()),
      failureReason: p.failureReason,
      createdAt: p.createdAt,
    })),
  };
}
