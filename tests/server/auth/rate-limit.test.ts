import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/server/redis", async () => {
  const { makeFakeRedis } = await import("../../helpers/fake-redis");
  return { redis: makeFakeRedis() };
});

import { redis } from "@/server/redis";
import { rateLimit } from "@/server/auth/rate-limit";

const fake = redis as unknown as { _reset: () => void };

describe("rateLimit", () => {
  beforeEach(() => {
    fake._reset();
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
  });
  afterEach(() => vi.restoreAllMocks());

  it("allows up to the limit then throws tooManyRequests", async () => {
    await rateLimit("login:ip:1.2.3.4", { limit: 2, windowSec: 60 });
    await rateLimit("login:ip:1.2.3.4", { limit: 2, windowSec: 60 });
    await expect(rateLimit("login:ip:1.2.3.4", { limit: 2, windowSec: 60 })).rejects.toMatchObject({
      status: 429,
    });
  });

  it("refills after the window elapses", async () => {
    await rateLimit("k", { limit: 1, windowSec: 60 });
    await expect(rateLimit("k", { limit: 1, windowSec: 60 })).rejects.toMatchObject({
      status: 429,
    });

    (Date.now as unknown as { mockReturnValue: (n: number) => void }).mockReturnValue(
      1_000_000 + 60_000,
    );
    await expect(rateLimit("k", { limit: 1, windowSec: 60 })).resolves.toBeUndefined();
  });

  it("keys are independent", async () => {
    await rateLimit("a", { limit: 1, windowSec: 60 });
    await expect(rateLimit("b", { limit: 1, windowSec: 60 })).resolves.toBeUndefined();
  });
});
