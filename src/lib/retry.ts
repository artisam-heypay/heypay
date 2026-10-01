// src/lib/retry.ts
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`operation timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

export class CircuitOpenError extends Error {
  constructor() {
    super("circuit breaker is open");
    this.name = "CircuitOpenError";
  }
}

export type RetryOptions = {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  timeoutMs?: number;
  jitter?: boolean;
  label?: string; // human label for logs/poll-timeout messages (Phase 5 callers)
  isRetryable?: (err: unknown) => boolean;
  sleepImpl?: (ms: number) => Promise<void>;
  randomImpl?: () => number;
};

export type PollOpts = { attempts?: number; intervalMs?: number; label?: string };

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(ms)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseMs = opts.baseMs ?? 200;
  const maxMs = opts.maxMs ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 10000;
  const jitter = opts.jitter ?? true;
  const isRetryable = opts.isRetryable ?? (() => true);
  const sleep = opts.sleepImpl ?? realSleep;
  const random = opts.randomImpl ?? Math.random;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(fn(attempt), timeoutMs);
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) break;
      const capped = Math.min(maxMs, baseMs * 2 ** attempt);
      const delay = jitter ? Math.floor(random() * capped) : capped;
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Poll `fn` until `done(value)` is true; throws after `attempts`. Returns the
 * last value when done. Used by the worker to await PDAX trade/payout fills.
 */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  done: (v: T) => boolean,
  opts: PollOpts = {},
): Promise<T> {
  const attempts = opts.attempts ?? 30;
  const intervalMs = opts.intervalMs ?? 1_000;
  let value!: T;
  for (let i = 0; i < attempts; i++) {
    value = await fn();
    if (done(value)) return value;
    if (i < attempts - 1) await realSleep(intervalMs);
  }
  throw new Error(
    `pollUntil timed out${opts.label ? ` (${opts.label})` : ""} after ${attempts} attempts`,
  );
}

export type CircuitBreakerOptions = {
  failureThreshold?: number;
  resetMs?: number;
  nowImpl?: () => number;
};
export type CircuitState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private readonly threshold: number;
  private readonly resetMs: number;
  private readonly now: () => number;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.threshold = opts.failureThreshold ?? 5;
    this.resetMs = opts.resetMs ?? 30_000;
    this.now = opts.nowImpl ?? Date.now;
  }

  get state(): CircuitState {
    if (this.failures < this.threshold) return "closed";
    if (this.now() - this.openedAt >= this.resetMs) return "half-open";
    return "open";
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    const s = this.state;
    if (s === "open") throw new CircuitOpenError();
    try {
      const result = await fn();
      this.failures = 0; // success closes the circuit
      return result;
    } catch (err) {
      this.failures += 1;
      if (this.failures >= this.threshold) this.openedAt = this.now();
      throw err;
    }
  }
}
