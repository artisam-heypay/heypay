import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { resetDb } from "../../../tests/helpers/db";
import { withIdempotencyKey } from "./idempotency";
import { AppError } from "@/lib/errors";

describe("withIdempotencyKey", () => {
  beforeEach(resetDb);

  it("runs fn once and replays the cached response", async () => {
    const key = randomUUID();
    const fn = vi.fn().mockResolvedValue({ ok: true, n: 1 });
    const a = await withIdempotencyKey(key, "test.scope", fn);
    const b = await withIdempotencyKey(key, "test.scope", fn);
    expect(a).toEqual({ ok: true, n: 1 });
    expect(b).toEqual({ ok: true, n: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("scopes keys: same key under a different scope runs again", async () => {
    const key = randomUUID();
    const fn = vi.fn().mockResolvedValue({ v: 1 });
    await withIdempotencyKey(key, "scope.a", fn);
    await withIdempotencyKey(key, "scope.b", fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rejects a concurrent in-flight call for the same key with conflict (409)", async () => {
    const key = randomUUID();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = withIdempotencyKey(key, "test.scope", async () => {
      await gate;
      return { done: true };
    });
    await expect(
      withIdempotencyKey(key, "test.scope", async () => ({ done: false })),
    ).rejects.toMatchObject({ status: 409 });
    release();
    await expect(slow).resolves.toEqual({ done: true });
  });

  it("throws badRequest (400) when the key is missing", async () => {
    await expect(withIdempotencyKey("", "test.scope", async () => 1)).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(withIdempotencyKey(undefined, "test.scope", async () => 1)).rejects.toMatchObject({
      status: 400,
    });
  });
});
