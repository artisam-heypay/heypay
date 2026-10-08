import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fastSettleEnabled, selectRail } from "@/server/rails/index";
import { mockProvider } from "@/server/rails/mock";
import { xenditProvider } from "@/server/rails/xendit";

describe("selectRail", () => {
  it("returns the Xendit provider for PAYMENT_RAIL=xendit", () => {
    expect(selectRail("xendit")).toBe(xenditProvider);
    expect(selectRail(' "Xendit" ')).toBe(xenditProvider);
  });
  it("returns the mock provider for PAYMENT_RAIL=mock", () => {
    expect(selectRail("mock")).toBe(mockProvider);
  });
  it("defaults to the mock provider when unset or unknown, including the retired pdax", () => {
    expect(selectRail(undefined)).toBe(mockProvider);
    expect(selectRail("nonsense")).toBe(mockProvider);
    expect(selectRail("pdax")).toBe(mockProvider);
  });
});

describe("fastSettleEnabled", () => {
  const KEYS = [
    "PAYMENT_RAIL",
    "XENDIT_SECRET_KEY",
    "PAYOUT_FAST_SETTLE",
    "STELLAR_NETWORK",
    "STELLAR_NETWORK_PASSPHRASE",
  ] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    process.env.PAYMENT_RAIL = "xendit";
    process.env.XENDIT_SECRET_KEY = "xnd_development_abc";
    process.env.STELLAR_NETWORK = "testnet";
    delete process.env.PAYOUT_FAST_SETTLE;
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("is on for a Xendit test key on testnet", () => {
    expect(fastSettleEnabled()).toBe(true);
  });
  it("is off for a production key", () => {
    process.env.XENDIT_SECRET_KEY = "xnd_production_abc";
    expect(fastSettleEnabled()).toBe(false);
  });
  it("is off when no key is set", () => {
    delete process.env.XENDIT_SECRET_KEY;
    expect(fastSettleEnabled()).toBe(false);
  });
  it("is off on mainnet, even with a test key", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    expect(fastSettleEnabled()).toBe(false);
  });
  it("is off on the mock rail", () => {
    process.env.PAYMENT_RAIL = "mock";
    expect(fastSettleEnabled()).toBe(false);
  });
  it("is off when PAYOUT_FAST_SETTLE=false", () => {
    process.env.PAYOUT_FAST_SETTLE = ' "False" ';
    expect(fastSettleEnabled()).toBe(false);
  });
});
