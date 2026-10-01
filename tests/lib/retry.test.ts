import { describe, it, expect, vi } from "vitest";
import {
  withRetry,
  withTimeout,
  pollUntil,
  TimeoutError,
  CircuitBreaker,
  CircuitOpenError,
} from "@/lib/retry";

const noSleep = (_ms: number) => Promise.resolve();

describe("withRetry", () => {
  it("succeeds after N transient failures", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error("transient");
      return "ok";
    });
    const result = await withRetry(fn, {
      retries: 5,
      baseMs: 1,
      sleepImpl: noSleep,
      randomImpl: () => 0,
    });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after max retries and throws the last error", async () => {
    const fn = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(
      withRetry(fn, { retries: 2, baseMs: 1, sleepImpl: noSleep, randomImpl: () => 0 }),
    ).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("respects isRetryable=false (no retry on non-retryable errors)", async () => {
    const fn = vi.fn(async () => {
      throw new Error("fatal");
    });
    await expect(
      withRetry(fn, { retries: 5, baseMs: 1, sleepImpl: noSleep, isRetryable: () => false }),
    ).rejects.toThrow("fatal");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("times out a hung attempt with TimeoutError", async () => {
    const hung = () => new Promise<string>(() => {});
    await expect(
      withRetry(hung, { retries: 0, timeoutMs: 10, sleepImpl: noSleep }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it("backoff is exponential and capped by maxMs", async () => {
    const delays: number[] = [];
    const fn = vi.fn(async () => {
      throw new Error("x");
    });
    await expect(
      withRetry(fn, {
        retries: 4,
        baseMs: 100,
        maxMs: 350,
        jitter: false,
        sleepImpl: (ms) => {
          delays.push(ms);
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow();
    // 100, 200, 350 (capped), 350 (capped) — one delay per retry
    expect(delays).toEqual([100, 200, 350, 350]);
  });
});

describe("withTimeout", () => {
  it("resolves when the promise wins the race", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });
  it("rejects with TimeoutError when the timeout wins", async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe("pollUntil", () => {
  it("resolves when the predicate is satisfied", async () => {
    let n = 0;
    const v = await pollUntil(
      async () => ++n,
      (x) => x >= 3,
      { attempts: 5, intervalMs: 1 },
    );
    expect(v).toBe(3);
  });

  it("throws (with label) when not done within attempts", async () => {
    await expect(
      pollUntil(
        async () => 0,
        (x) => x === 1,
        { attempts: 3, intervalMs: 1, label: "trade" },
      ),
    ).rejects.toThrow(/trade/);
  });
});

describe("CircuitBreaker", () => {
  it("opens after the failure threshold then rejects fast", async () => {
    const now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 2, resetMs: 1000, nowImpl: () => now });
    const boom = () => Promise.reject(new Error("down"));
    await expect(cb.exec(boom)).rejects.toThrow("down");
    await expect(cb.exec(boom)).rejects.toThrow("down");
    expect(cb.state).toBe("open");
    // while open, the wrapped fn is NOT called — we get CircuitOpenError
    const spy = vi.fn(() => Promise.resolve("should-not-run"));
    await expect(cb.exec(spy)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("half-opens after resetMs and closes on a success", async () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, resetMs: 1000, nowImpl: () => now });
    await expect(cb.exec(() => Promise.reject(new Error("down")))).rejects.toThrow("down");
    expect(cb.state).toBe("open");
    now = 1500; // past resetMs → half-open allows one trial
    await expect(cb.exec(() => Promise.resolve("ok"))).resolves.toBe("ok");
    expect(cb.state).toBe("closed");
  });
});
