import { beforeEach, describe, expect, it, vi } from "vitest";

// Freighter, as the wallets kit shows it to the page.
const { freighter } = vi.hoisted(() => ({
  freighter: {
    isAvailable: vi.fn(),
    getNetwork: vi.fn(),
    fetchAddress: vi.fn(),
    signTransaction: vi.fn(),
  },
}));
vi.mock("@creit.tech/stellar-wallets-kit/sdk", () => ({
  StellarWalletsKit: {
    init: vi.fn(),
    selectedModule: { isAvailable: () => freighter.isAvailable() },
    getNetwork: () => freighter.getNetwork(),
    fetchAddress: () => freighter.fetchAddress(),
    signTransaction: (xdr: string, opts: unknown) => freighter.signTransaction(xdr, opts),
  },
}));
vi.mock("@creit.tech/stellar-wallets-kit/modules/freighter", () => ({
  FreighterModule: class {},
  FREIGHTER_ID: "freighter",
}));

import { signWithFreighter } from "./freighter";

const TESTNET = "Test SDF Network ; September 2015";
const OWN = "GOWN" + "A".repeat(48) + "WXYZ";
const EXPECTED = { address: OWN, networkPassphrase: TESTNET, networkName: "Testnet" };

beforeEach(() => {
  freighter.isAvailable.mockReset().mockResolvedValue(true);
  freighter.getNetwork.mockReset().mockResolvedValue({ networkPassphrase: TESTNET });
  freighter.fetchAddress.mockReset().mockResolvedValue({ address: OWN });
  freighter.signTransaction.mockReset().mockResolvedValue({ signedTxXdr: "SIGNED-XDR" });
});

describe("signWithFreighter", () => {
  it("hands back what Freighter signed, asked of the connected account on HeyPay's network", async () => {
    expect(await signWithFreighter("UNSIGNED-XDR", EXPECTED)).toEqual({
      ok: true,
      signedXdr: "SIGNED-XDR",
    });
    expect(freighter.signTransaction).toHaveBeenCalledWith("UNSIGNED-XDR", {
      networkPassphrase: TESTNET,
      address: OWN,
    });
  });

  it("says the payer cancelled when they reject the request in Freighter", async () => {
    freighter.signTransaction.mockRejectedValue({
      code: -4,
      message: "The user rejected this request.",
    });
    expect(await signWithFreighter("UNSIGNED-XDR", EXPECTED)).toEqual({
      ok: false,
      reason: "cancelled",
      message: "You cancelled — nothing was sent.",
    });
  });

  it("does not call a failure of Freighter's own a cancellation", async () => {
    freighter.signTransaction.mockRejectedValue({ code: -1, message: "internal error" });
    const result = await signWithFreighter("UNSIGNED-XDR", EXPECTED);
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(result).toMatchObject({ message: expect.stringMatching(/nothing was sent/) });
  });

  it("treats a signature that never came back as a failure", async () => {
    freighter.signTransaction.mockResolvedValue({ signedTxXdr: "" });
    expect(await signWithFreighter("UNSIGNED-XDR", EXPECTED)).toMatchObject({
      ok: false,
      reason: "failed",
    });
  });

  it("asks for no signature on another network, and says which one to switch to", async () => {
    freighter.getNetwork.mockResolvedValue({
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });
    const result = await signWithFreighter("UNSIGNED-XDR", EXPECTED);
    expect(result).toMatchObject({ ok: false, reason: "wrong_network" });
    expect(result).toMatchObject({
      message: expect.stringMatching(/In Freighter, switch the network to Testnet/),
    });
    expect(freighter.signTransaction).not.toHaveBeenCalled();
  });

  it("asks for no signature on another account, and names the one to switch to", async () => {
    freighter.fetchAddress.mockResolvedValue({ address: "GOTHER" + "B".repeat(50) });
    const result = await signWithFreighter("UNSIGNED-XDR", EXPECTED);
    expect(result).toMatchObject({ ok: false, reason: "wrong_account" });
    expect(result).toMatchObject({
      message: expect.stringMatching(/In Freighter, switch to GOWN…WXYZ/),
    });
    expect(freighter.signTransaction).not.toHaveBeenCalled();
  });

  it("says the payer cancelled when they refuse to share their account", async () => {
    freighter.fetchAddress.mockRejectedValue({ code: -4, message: "The user rejected access" });
    expect(await signWithFreighter("UNSIGNED-XDR", EXPECTED)).toMatchObject({
      ok: false,
      reason: "cancelled",
    });
    expect(freighter.signTransaction).not.toHaveBeenCalled();
  });

  it("says so when Freighter is not in the browser", async () => {
    freighter.isAvailable.mockResolvedValue(false);
    expect(await signWithFreighter("UNSIGNED-XDR", EXPECTED)).toMatchObject({
      ok: false,
      reason: "not_installed",
    });
    expect(freighter.getNetwork).not.toHaveBeenCalled();
  });
});
