import "server-only";
import { Queue } from "bullmq";
import { redis } from "@/server/redis";
import { QUEUE_NAMES } from "@/server/queue/queues";

export type ComponentHealth = {
  name: "stellar" | "pdax" | "redis" | "queue";
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

async function checkPdax(): Promise<ComponentHealth> {
  if ((process.env.PAYMENT_RAIL ?? "mock") === "mock") {
    return { name: "pdax", status: "ok", detail: "mock rail" };
  }
  const url = process.env.PDAX_BASE_URL ?? "";
  if (!url) return { name: "pdax", status: "down", detail: "PDAX_BASE_URL unset" };
  try {
    const { value: res, ms } = await timed(() => fetchWithTimeout(url, 3000));
    return {
      name: "pdax",
      status: res.status < 500 ? "ok" : "degraded",
      detail: `PDAX ${res.status}`,
      latencyMs: ms,
    };
  } catch {
    return { name: "pdax", status: "down", detail: "PDAX unreachable" };
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
  const components = await Promise.all([checkStellar(), checkPdax(), checkRedis(), checkQueue()]);
  const anyDown = components.some((c) => c.status === "down");
  const anyDegraded = components.some((c) => c.status === "degraded");
  const status: SystemHealth["status"] = anyDown ? "down" : anyDegraded ? "degraded" : "ok";
  return { status, checkedAt: new Date().toISOString(), components };
}

export async function shallowHealth(): Promise<{ status: "ok"; uptimeSec: number }> {
  return { status: "ok", uptimeSec: Math.round((Date.now() - START) / 1000) };
}
