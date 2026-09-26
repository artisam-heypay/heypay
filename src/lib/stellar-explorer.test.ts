import { describe, it, expect } from "vitest";
import { stellarTxUrl } from "./stellar-explorer";

describe("stellarTxUrl", () => {
  it("links testnet transactions to the testnet explorer", () => {
    expect(stellarTxUrl("abc123", "testnet")).toBe(
      "https://stellar.expert/explorer/testnet/tx/abc123",
    );
  });
  it("links mainnet transactions to the public explorer", () => {
    expect(stellarTxUrl("abc123", "mainnet")).toBe(
      "https://stellar.expert/explorer/public/tx/abc123",
    );
  });
  it("defaults to testnet when the network is unset", () => {
    expect(stellarTxUrl("abc123", undefined)).toContain("/explorer/testnet/");
  });
});
