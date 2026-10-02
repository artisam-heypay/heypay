import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@/server/observability/error-tracking", () => ({ captureException }));

import { escrowTimeoutLedgers } from "@/server/stellar/escrow-config";

describe("escrowTimeoutLedgers", () => {
  beforeEach(() => {
    captureException.mockClear();
  });
  afterEach(() => {
    delete process.env.ESCROW_TIMEOUT_LEDGERS;
  });

  it("is null when unset or empty, so the contract's own window stays", () => {
    expect(escrowTimeoutLedgers()).toBeNull();
    process.env.ESCROW_TIMEOUT_LEDGERS = "  ";
    expect(escrowTimeoutLedgers()).toBeNull();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reads a positive ledger count", () => {
    process.env.ESCROW_TIMEOUT_LEDGERS = " 12 ";
    expect(escrowTimeoutLedgers()).toBe(12);
    process.env.ESCROW_TIMEOUT_LEDGERS = "17280";
    expect(escrowTimeoutLedgers()).toBe(17_280);
  });

  it.each(["0", "-5", "1.5", "12s", "4294967296"])("ignores %s and reports it once", (value) => {
    process.env.ESCROW_TIMEOUT_LEDGERS = value;
    expect(escrowTimeoutLedgers()).toBeNull();
    expect(escrowTimeoutLedgers()).toBeNull();
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
