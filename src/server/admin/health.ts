import "server-only";
import { Queue } from "bullmq";
import { redis } from "@/server/redis";
import { QUEUE_NAMES } from "@/server/queue/queues";

export type ComponentHealth = {
  name: "stellar" | "payouts" | "rates" | "redis" | "queue";
  status: "ok" | "degraded" | "down";
  detail: string;
  latencyMs?: number;
  queueDepth?: number;
};
export type SystemHealth = {
  status: "ok" | "degraded" | "down";
  checkedAt: string;
  components: ComponentHealth[];
};

const START = Date.now();

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0 };
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, method: "GET" });
  } finally {
    clearTimeout(t);
  }
}

async function checkStellar(): Promise<ComponentHealth> {
  const url = process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org";
  try {
    const { value: res, ms } = await timed(() => fetchWithTimeout(url, 3000));
    return res.ok
      ? { name: "stellar", status: "ok", detail: `Horizon ${res.status}`, latencyMs: ms }
      : { name: "stellar", status: "degraded", detail: `Horizon ${res.status}`, latencyMs: ms };
  } catch {
    return { name: "stellar", status: "down", detail: "Horizon unreachable" };
  }
}

async function checkPayouts(): Promise<ComponentHealth> {
  if ((process.env.PAYMENT_RAIL ?? "mock").trim().toLowerCase() !== "xendit") {
    return { name: "payouts", status: "ok", detail: "mock rail" };
  }
  const key = process.env.XENDIT_SECRET_KEY?.trim();
  if (!key) return { name: "payouts", status: "down", detail: "XENDIT_SECRET_KEY unset" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    // The PHP balance is what every merchant payout is paid from, so it is the
    // number worth watching here, not just reachability.
    const { value: res, ms } = await timed(() =>
      fetch("https://api.xendit.co/balance", {
        signal: ctrl.signal,
        headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
      }),
    );
    if (!res.ok) {
      return { name: "payouts", status: "degraded", detail: `Xendit ${res.status}`, latencyMs: ms };
    }
    const body = (await res.json()) as { balance?: number };
    return {
      name: "payouts",
      status: "ok",
      detail: `Xendit balance ₱${Number(body.balance ?? 0).toLocaleString("en-PH")}`,
      latencyMs: ms,
    };
  } catch {
    return { name: "payouts", status: "down", detail: "Xendit unreachable" };
  } finally {
    clearTimeout(t);
  }
}

async function checkRates(): Promise<ComponentHealth> {
  const url = "https://api.pro.coins.ph/openapi/quote/v1/ticker/bookTicker?symbol=XLMPHP";
  try {
    const { value: res, ms } = await timed(() => fetchWithTimeout(url, 3000));
    return res.ok
      ? { name: "rates", status: "ok", detail: `Coins.ph ${res.status}`, latencyMs: ms }
      : { name: "rates", status: "degraded", detail: `Coins.ph ${res.status}`, latencyMs: ms };
  } catch {
    // CoinMarketCap still backs quotes when Coins.ph is down.
    return { name: "rates", status: "degraded", detail: "Coins.ph unreachable" };
  }
}

async function checkRedis(): Promise<ComponentHealth> {
  try {
    const { value: pong, ms } = await timed(() => redis.ping());
    return {
      name: "redis",
      status: pong === "PONG" ? "ok" : "degraded",
      detail: pong,
      latencyMs: ms,
    };
  } catch {
    return { name: "redis", status: "down", detail: "Redis unreachable" };
  }
}

async function checkQueue(): Promise<ComponentHealth> {
  const queue = new Queue(QUEUE_NAMES.settle, { connection: redis });
  try {
    const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");
    const depth = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
    return {
      name: "queue",
      status: (counts.failed ?? 0) > 0 ? "degraded" : "ok",
      detail: `waiting ${counts.waiting ?? 0} · active ${counts.active ?? 0} · failed ${counts.failed ?? 0}`,
      queueDepth: depth,
    };
  } catch {
    return { name: "queue", status: "down", detail: "BullMQ unreachable", queueDepth: 0 };
  } finally {
    await queue.close();
  }
}

export async function checkHealth(): Promise<SystemHealth> {
  const components = await Promise.all([
    checkStellar(),
    checkPayouts(),
    checkRates(),
    checkRedis(),
    checkQueue(),
  ]);
  const anyDown = components.some((c) => c.status === "down");
  const anyDegraded = components.some((c) => c.status === "degraded");
  const status: SystemHealth["status"] = anyDown ? "down" : anyDegraded ? "degraded" : "ok";
  return { status, checkedAt: new Date().toISOString(), components };
}

export async function shallowHealth(): Promise<{ status: "ok"; uptimeSec: number }> {
  return { status: "ok", uptimeSec: Math.round((Date.now() - START) / 1000) };
}
