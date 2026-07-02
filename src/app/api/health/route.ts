import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { redis } from "@/server/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req?: NextRequest): Promise<NextResponse> {
  const checks = { db: false, redis: false };
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch {
    // health probe: swallow, report degraded
  }
  try {
    await redis.ping();
    checks.redis = true;
  } catch {
    // health probe: swallow, report degraded
  }
  const ok = checks.db && checks.redis;
  return NextResponse.json({ status: ok ? "ok" : "degraded", checks }, { status: ok ? 200 : 503 });
}
