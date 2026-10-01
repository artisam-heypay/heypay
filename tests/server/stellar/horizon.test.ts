import { Horizon, Networks } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetHorizonForTests, getHorizon, getNetworkPassphrase } from "@/server/stellar/horizon";

beforeEach(() => {
  process.env.STELLAR_HORIZON_URL = "https://horizon-testnet.stellar.org";
  process.env.STELLAR_NETWORK = "testnet";
  delete process.env.STELLAR_NETWORK_PASSPHRASE;
  __resetHorizonForTests();
});

describe("horizon singleton", () => {
  it("returns a Horizon.Server and caches it", () => {
    const a = getHorizon();
    const b = getHorizon();
    expect(a).toBeInstanceOf(Horizon.Server);
    expect(a).toBe(b);
  });

  it("defaults to the testnet passphrase", () => {
    expect(getNetworkPassphrase()).toBe(Networks.TESTNET);
  });

  it("selects the public passphrase for mainnet", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    expect(getNetworkPassphrase()).toBe(Networks.PUBLIC);
  });

  it("honours an explicit passphrase override", () => {
    process.env.STELLAR_NETWORK_PASSPHRASE = "Custom Net ; 2026";
    expect(getNetworkPassphrase()).toBe("Custom Net ; 2026");
  });

  it("throws when STELLAR_HORIZON_URL is missing", () => {
    delete process.env.STELLAR_HORIZON_URL;
    __resetHorizonForTests();
    expect(() => getHorizon()).toThrow(/STELLAR_HORIZON_URL/);
  });
});
