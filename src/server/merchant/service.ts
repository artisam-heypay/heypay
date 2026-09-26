import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db";
import { notFound } from "@/lib/errors";
import { dec, formatAsset, formatPhp, type Decimal } from "@/lib/money";
import type { PaymentAsset } from "@/lib/assets";
import type { Merchant, Payment, PaymentStatus } from "@/generated/prisma/client";
import { MerchantStatus } from "@/generated/prisma/client";
import type { TxQuery } from "@/lib/schemas/merchant";

export type MerchantDto = {
  id: string;
  businessName: string;
  logoKey: string | null;
  status: MerchantStatus;
  qrphRaw: string;
  qrphMerchantName: string | null;
  qrphMerchantCity: string | null;
  qrphMerchantId: string | null;
  qrphImageKey: string | null;
  qrphCountry: string | null;
  qrphCurrency: string | null;
  settlementBankCode: string;
  settlementBankName: string;
  accountName: string;
  accountNumberLast4: string;
  payoutEmail: string | null;
  createdAt: string;
  updatedAt: string;
};
export type SetupState = {
  hasBusiness: boolean;
  hasSettlement: boolean;
  hasQrph: boolean;
  isComplete: boolean;
};
export type MerchantTxItem = {
  id: string;
  reference: string;
  customer: string;
  /** The payer's funding asset; the merchant is still settled in PHP. */
  asset: PaymentAsset;
  amountAsset: string;
  amountPhp: string;
  netSettledPhp: string | null;
  status: PaymentStatus;
  createdAt: string;
};
export type MerchantTxPage = { items: MerchantTxItem[]; nextCursor: string | null };
export type EarningsRange = "1d" | "1w" | "1m" | "all";
export const EARNINGS_RANGES: readonly EarningsRange[] = ["1d", "1w", "1m", "all"];
export type EarningsBucket = "hour" | "day" | "week" | "month";
/** One point of the settled-PHP series; `t` is the bucket's start (ISO, UTC). */
export type EarningsPoint = { t: string; php: string };
export type MerchantEarnings = {
  range: EarningsRange;
  /** PHP paid out to the merchant within the range. */
  totalSettledPhp: string;
  settledCount: number;
  /** Change vs the equally long period just before; null for "all" or no prior data. */
  changePct: number | null;
  /** PHP of payments still on their way to the merchant, whatever coin paid them. */
  pendingPhp: string;
  pendingCount: number;
  bucket: EarningsBucket;
  series: EarningsPoint[];
};

export function parseEarningsRange(v: string | null | undefined): EarningsRange {
  return (EARNINGS_RANGES as readonly string[]).includes(v ?? "") ? (v as EarningsRange) : "1m";
}

/** Non-terminal in-flight states: the payer has paid, the merchant is not yet paid out. */
export const PENDING_STATUSES: PaymentStatus[] = [
  "AUTHORIZED",
  "STELLAR_SUBMITTED",
  "STELLAR_CONFIRMED",
  "PAYOUT_SUBMITTED",
];

export function serializeMerchant(m: Merchant): MerchantDto {
  return {
    id: m.id,
    businessName: m.businessName,
    logoKey: m.logoKey,
    status: m.status,
    qrphRaw: m.qrphRaw,
    qrphMerchantName: m.qrphMerchantName,
    qrphMerchantCity: m.qrphMerchantCity,
    qrphMerchantId: m.qrphMerchantId,
    qrphImageKey: m.qrphImageKey,
    qrphCountry: m.qrphCountry,
    qrphCurrency: m.qrphCurrency,
    settlementBankCode: m.settlementBankCode,
    settlementBankName: m.settlementBankName,
    accountName: m.accountName,
    accountNumberLast4: m.accountNumberLast4,
    payoutEmail: m.payoutEmail,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export function merchantSetupState(m: Merchant): SetupState {
  const hasBusiness = m.businessName.trim().length > 0;
  // Settlement is only usable with somewhere to send the payout receipt.
  const hasSettlement =
    m.settlementBankCode.length > 0 && m.accountNumberLast4.length > 0 && Boolean(m.payoutEmail);
  const hasQrph = m.qrphRaw.length > 0;
  return {
    hasBusiness,
    hasSettlement,
    hasQrph,
    isComplete: hasBusiness && hasSettlement && hasQrph,
  };
}

export function getMerchantForUserOrNull(userId: string): Promise<Merchant | null> {
  return prisma.merchant.findUnique({ where: { userId } });
}

export async function getMerchantForUser(userId: string): Promise<Merchant> {
  const m = await getMerchantForUserOrNull(userId);
  if (!m) throw notFound("Merchant profile not found");
  return m;
}

/** For Server Components: redirect to onboarding instead of rendering a 404. */
export async function requireMerchant(userId: string): Promise<Merchant> {
  const m = await getMerchantForUserOrNull(userId);
  if (!m) redirect("/merchant/onboarding");
  return m;
}

// Merchants are in the Philippines (UTC+8, no DST): buckets follow their wall clock.
const PH_OFFSET_MS = 8 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

/** Start of the bucket containing `d`, in PH time, returned as a UTC instant. */
function bucketStart(d: Date, bucket: EarningsBucket): Date {
  const l = new Date(d.getTime() + PH_OFFSET_MS); // UTC fields now read as PH wall clock
  const [y, m, day] = [l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()];
  const local =
    bucket === "hour"
      ? Date.UTC(y, m, day, l.getUTCHours())
      : bucket === "day"
        ? Date.UTC(y, m, day)
        : bucket === "week"
          ? Date.UTC(y, m, day - ((l.getUTCDay() + 6) % 7)) // weeks start Monday
          : Date.UTC(y, m, 1);
  return new Date(local - PH_OFFSET_MS);
}

function nextBucket(d: Date, bucket: EarningsBucket): Date {
  if (bucket === "hour") return new Date(d.getTime() + HOUR_MS);
  if (bucket === "day") return new Date(d.getTime() + DAY_MS);
  if (bucket === "week") return new Date(d.getTime() + 7 * DAY_MS);
  const l = new Date(d.getTime() + PH_OFFSET_MS);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth() + 1, 1) - PH_OFFSET_MS);
}

/** The range's window [start, now] and bucket size; "all" is sized from the first payout. */
function rangeWindow(
  range: EarningsRange,
  now: Date,
  firstSettledAt: Date | null,
): { start: Date; bucket: EarningsBucket } {
  if (range === "1d")
    return { start: bucketStart(new Date(now.getTime() - 23 * HOUR_MS), "hour"), bucket: "hour" };
  if (range === "1w")
    return { start: bucketStart(new Date(now.getTime() - 6 * DAY_MS), "day"), bucket: "day" };
  if (range === "1m")
    return { start: bucketStart(new Date(now.getTime() - 29 * DAY_MS), "day"), bucket: "day" };
  const first = firstSettledAt ?? now;
  const spanDays = (now.getTime() - first.getTime()) / DAY_MS;
  const bucket: EarningsBucket = spanDays <= 62 ? "day" : spanDays <= 7 * 104 ? "week" : "month";
  return { start: bucketStart(first, bucket), bucket };
}

export async function getMerchantEarnings(
  merchantId: string,
  range: EarningsRange = "1m",
  now: Date = new Date(),
): Promise<MerchantEarnings> {
  const first =
    range === "all"
      ? await prisma.payment.findFirst({
          where: { merchantId, status: "SETTLED", settledAt: { not: null } },
          orderBy: { settledAt: "asc" },
          select: { settledAt: true },
        })
      : null;
  const { start, bucket } = rangeWindow(range, now, first?.settledAt ?? null);
  const periodMs = now.getTime() - start.getTime();
  const prevStart = new Date(start.getTime() - periodMs);

  const [settled, previous, pending] = await Promise.all([
    prisma.payment.findMany({
      where: { merchantId, status: "SETTLED", settledAt: { gte: start, lte: now } },
      select: { netSettledPhp: true, settledAt: true },
    }),
    range === "all"
      ? Promise.resolve([])
      : prisma.payment.findMany({
          where: { merchantId, status: "SETTLED", settledAt: { gte: prevStart, lt: start } },
          select: { netSettledPhp: true },
        }),
    prisma.payment.findMany({
      where: { merchantId, status: { in: PENDING_STATUSES } },
      select: { amountPhp: true },
    }),
  ]);

  // Zero-filled buckets, so the line shows quiet periods instead of skipping them.
  const sums = new Map<number, Decimal>();
  for (let b = start; b.getTime() <= now.getTime(); b = nextBucket(b, bucket)) {
    sums.set(b.getTime(), dec(0));
  }
  let total = dec(0);
  for (const p of settled) {
    const v = dec(p.netSettledPhp?.toString() ?? "0");
    total = total.plus(v);
    const key = bucketStart(p.settledAt!, bucket).getTime();
    sums.set(key, (sums.get(key) ?? dec(0)).plus(v));
  }
  const prevTotal = previous.reduce(
    (acc, p) => acc.plus(dec(p.netSettledPhp?.toString() ?? "0")),
    dec(0),
  );
  const changePct =
    range === "all" || prevTotal.isZero()
      ? null
      : Number(
          total.minus(prevTotal).dividedBy(prevTotal).times(100).toDecimalPlaces(1).toString(),
        );
  const pendingPhp = pending.reduce((acc, p) => acc.plus(dec(p.amountPhp.toString())), dec(0));

  return {
    range,
    totalSettledPhp: formatPhp(total),
    settledCount: settled.length,
    changePct,
    pendingPhp: formatPhp(pendingPhp),
    pendingCount: pending.length,
    bucket,
    series: [...sums.entries()]
      .sort(([a], [b]) => a - b)
      .map(([t, v]) => ({ t: new Date(t).toISOString(), php: formatPhp(v) })),
  };
}

function mapTx(p: Payment & { payer: { username: string } }): MerchantTxItem {
  return {
    id: p.id,
    reference: p.reference,
    customer: p.payer.username,
    asset: p.asset,
    amountAsset: formatAsset(dec(p.amountAsset.toString())),
    amountPhp: formatPhp(dec(p.amountPhp.toString())),
    netSettledPhp: p.netSettledPhp ? formatPhp(dec(p.netSettledPhp.toString())) : null,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  };
}

function txWhere(merchantId: string, q: Pick<TxQuery, "status" | "from" | "to">) {
  return {
    merchantId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.from || q.to
      ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
      : {}),
  };
}

export async function listMerchantTransactions(
  merchantId: string,
  q: TxQuery,
): Promise<MerchantTxPage> {
  const take = q.limit + 1;
  const rows = await prisma.payment.findMany({
    where: txWhere(merchantId, q),
    include: { payer: { select: { username: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    take,
  });
  const hasMore = rows.length === take;
  const items = (hasMore ? rows.slice(0, q.limit) : rows).map(mapTx);
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export async function allMerchantTransactions(
  merchantId: string,
  q: Pick<TxQuery, "status" | "from" | "to">,
): Promise<MerchantTxItem[]> {
  const rows = await prisma.payment.findMany({
    where: txWhere(merchantId, q),
    include: { payer: { select: { username: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return rows.map(mapTx);
}
