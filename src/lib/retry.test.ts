import { describe, it, expect } from "vitest";
import { pollUntil } from "./retry";

// `withRetry`, `withTimeout`, and `CircuitBreaker` are covered by tests/lib/retry.test.ts.
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

  it("throws when not done within attempts", async () => {
    await expect(
      pollUntil(
        async () => 0,
        (x) => x === 1,
        { attempts: 3, intervalMs: 1, label: "trade" },
      ),
    ).rejects.toThrow(/trade/);
  });
});
