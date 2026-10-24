// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Freighter, as the wallets kit shows it to the page: the extension, and the
// mobile app over WalletConnect.
const { kit, extension, app } = vi.hoisted(() => ({
  kit: {
    init: vi.fn(),
    setWallet: vi.fn(),
    getNetwork: vi.fn(),
    fetchAddress: vi.fn(),
    signTransaction: vi.fn(),
  },
  extension: { isAvailable: vi.fn() },
  app: {
    isAvailable: vi.fn(),
    getSessions: vi.fn(),
    request: vi.fn(),
    // The latest listener on WalletConnect's window, to open and close it.
    modalListener: null as ((state: { open: boolean }) => void) | null,
  },
}));
vi.mock("@creit.tech/stellar-wallets-kit/sdk", () => ({
  StellarWalletsKit: {
    init: (params: unknown) => kit.init(params),
    setWallet: (id: string) => kit.setWallet(id),
    getNetwork: () => kit.getNetwork(),
    fetchAddress: () => kit.fetchAddress(),
    signTransaction: (xdr: string, opts: unknown) => kit.signTransaction(xdr, opts),
  },
}));
vi.mock("@creit.tech/stellar-wallets-kit/modules/freighter", () => ({
  FreighterModule: class {
    productId = "freighter";
    isAvailable = () => extension.isAvailable();
  },
  FREIGHTER_ID: "freighter",
}));
vi.mock("@creit.tech/stellar-wallets-kit/modules/wallet-connect", () => ({
  WalletConnectModule: class {
    productId = "wallet_connect";
    isAvailable = () => app.isAvailable();
    getSessions = () => app.getSessions();
    signClient = { request: (params: unknown) => app.request(params) };
    modal = {
      subscribeState: (listener: (state: { open: boolean }) => void) => {
        app.modalListener = listener;
        return () => {};
      },
    };
  },
  WalletConnectTargetChain: { PUBLIC: "stellar:pubnet", TESTNET: "stellar:testnet" },
}));

const TESTNET = "Test SDF Network ; September 2015";
const OWN = "GOWN" + "A".repeat(48) + "WXYZ";
const OTHER = "GOTH" + "B".repeat(48) + "WXYZ";
const EXPECTED = { address: OWN, networkPassphrase: TESTNET, networkName: "Testnet" };
const NETWORK = { networkPassphrase: TESTNET, networkName: "Testnet" };

/** A WalletConnect session holding `accounts`, an hour from expiring. */
function session(topic: string, ...accounts: string[]) {
  return {
    topic,
    expiry: Date.now() / 1000 + 3600,
    namespaces: { stellar: { accounts } },
  };
}

/** The module fresh, as a page loads it: it keeps the kit it started. */
async function load() {
  vi.resetModules();
  return import("./freighter");
}

beforeEach(() => {
  kit.init.mockReset();
  kit.setWallet.mockReset();
  kit.getNetwork.mockReset().mockResolvedValue({ networkPassphrase: TESTNET });
  kit.fetchAddress.mockReset().mockResolvedValue({ address: OWN });
  kit.signTransaction.mockReset().mockResolvedValue({ signedTxXdr: "SIGNED-XDR" });
  extension.isAvailable.mockReset().mockResolvedValue(true);
  app.isAvailable.mockReset().mockResolvedValue(true);
  app.getSessions.mockReset().mockResolvedValue([]);
  app.request.mockReset().mockResolvedValue({ signedXDR: "SIGNED-IN-APP" });
  app.modalListener = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  delete (window as { stellar?: unknown }).stellar;
});

describe("signWithFreighter, with the extension", () => {
  it("hands back what Freighter signed, asked of the connected account on HeyPay's network", async () => {
    const { signWithFreighter } = await load();
    expect(await signWithFreighter("UNSIGNED-XDR", EXPECTED)).toEqual({
      ok: true,
      signedXdr: "SIGNED-XDR",
    });
    expect(kit.setWallet).toHaveBeenCalledWith("freighter");
    expect(kit.signTransaction).toHaveBeenCalledWith("UNSIGNED-XDR", {
      networkPassphrase: TESTNET,
      address: OWN,
    });
  });

  it("says the payer cancelled when they reject the request in Freighter", async () => {
    const { signWithFreighter } = await load();
    kit.signTransaction.mockRejectedValue({
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
    const { signWithFreighter } = await load();
    kit.signTransaction.mockRejectedValue({ code: -1, message: "internal error" });
    const result = await signWithFreighter("UNSIGNED-XDR", EXPECTED);
    expect(result).toMatchObject({ ok: false, reason: "failed" });
    expect(result).toMatchObject({ message: expect.stringMatching(/nothing was sent/) });
  });

  it("treats a signature that never came back as a failure", async () => {
    const { signWithFreighter } = await load();
    kit.signTransaction.mockResolvedValue({ signedTxXdr: "" });
    expect(await signWithFreighter("UNSIGNED-XDR", EXPECTED)).toMatchObject({
      ok: false,
      reason: "failed",
    });
  });

  it("asks for no signature on another network, and says which one to switch to", async () => {
    const { signWithFreighter } = await load();
    kit.getNetwork.mockResolvedValue({
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });
    const result = await signWithFreighter("UNSIGNED-XDR", EXPECTED);
    expect(result).toMatchObject({ ok: false, reason: "wrong_network" });
    expect(result).toMatchObject({
      message: expect.stringMatching(/In Freighter, switch the network to Testnet/),
    });
    expect(kit.signTransaction).not.toHaveBeenCalled();
  });

  it("asks for no signature on another account, and names the one to switch to", async () => {
    const { signWithFreighter } = await load();
    kit.fetchAddress.mockResolvedValue({ address: OTHER });
    const result = await signWithFreighter("UNSIGNED-XDR", EXPECTED);
    expect(result).toMatchObject({ ok: false, reason: "wrong_account" });
    expect(result).toMatchObject({
      message: expect.stringMatching(/In Freighter, switch to GOWN…WXYZ/),
    });
    expect(kit.signTransaction).not.toHaveBeenCalled();
  });

  it("says the payer cancelled when they refuse to share their account", async () => {
    const { signWithFreighter } = await load();
    kit.fetchAddress.mockRejectedValue({ code: -4, message: "The user rejected access" });
    expect(await signWithFreighter("UNSIGNED-XDR", EXPECTED)).toMatchObject({
      ok: false,
      reason: "cancelled",
    });
    expect(kit.signTransaction).not.toHaveBeenCalled();
  });

  it("says so when Freighter is not in the browser and the app can't connect here", async () => {
    const { signWithFreighter } = await load();
    extension.isAvailable.mockResolvedValue(false);
    const result = await signWithFreighter("UNSIGNED-XDR", EXPECTED);
    expect(result).toMatchObject({ ok: false, reason: "not_installed" });
    expect(result).toMatchObject({ message: expect.stringMatching(/not found in this browser/) });
    expect(kit.getNetwork).not.toHaveBeenCalled();
  });
});

describe("Freighter's mobile app", () => {
  beforeEach(() => {
    // Freighter's own browser marks the page so, and has no extension.
    (window as { stellar?: unknown }).stellar = { provider: "freighter", platform: "mobile" };
    extension.isAvailable.mockResolvedValue(false);
    vi.stubEnv("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", "wc-project");
  });

  it("can't connect without a WalletConnect project id, and says to use the extension", async () => {
    vi.stubEnv("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", "");
    const { connectFreighter } = await load();
    const result = await connectFreighter(NETWORK);
    expect(result).toMatchObject({ ok: false, reason: "not_installed" });
    expect(result).toMatchObject({
      message: expect.stringMatching(/mobile app can't connect to HeyPay yet/),
    });
    expect(kit.fetchAddress).not.toHaveBeenCalled();
  });

  it("connects over WalletConnect, on HeyPay's network only", async () => {
    const { connectFreighter } = await load();
    kit.fetchAddress.mockImplementation(async () => {
      app.getSessions.mockResolvedValue([session("t1", `stellar:testnet:${OWN}`)]);
      return { address: OWN };
    });
    expect(await connectFreighter(NETWORK)).toEqual({ ok: true, address: OWN });
    expect(kit.setWallet).toHaveBeenLastCalledWith("wallet_connect");
    expect(kit.init).toHaveBeenLastCalledWith(expect.objectContaining({ network: TESTNET }));
    expect(kit.getNetwork).not.toHaveBeenCalled(); // WalletConnect can't say; the session does
  });

  it("refuses an account the app shared on another network", async () => {
    const { connectFreighter } = await load();
    app.getSessions.mockResolvedValue([session("t1", `stellar:pubnet:${OWN}`)]);
    expect(await connectFreighter(NETWORK)).toMatchObject({ ok: false, reason: "wrong_network" });
  });

  it("counts closing WalletConnect's window without approving as a refusal", async () => {
    const { connectFreighter, CLOSE_GRACE_MS } = await load();
    kit.fetchAddress.mockReturnValue(new Promise(() => {})); // the app never answers
    vi.useFakeTimers();
    const result = connectFreighter(NETWORK);
    await vi.waitFor(() => expect(app.modalListener).not.toBeNull());
    app.modalListener!({ open: true });
    app.modalListener!({ open: false });
    await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS);
    expect(await result).toMatchObject({ ok: false, reason: "refused" });
  });

  it("signs in the app over the session that holds the payer's account", async () => {
    const { signWithFreighter } = await load();
    app.getSessions.mockResolvedValue([
      session("other", `stellar:testnet:${OTHER}`),
      session("own", `stellar:testnet:${OWN}`),
    ]);
    expect(await signWithFreighter("UNSIGNED-XDR", EXPECTED)).toEqual({
      ok: true,
      signedXdr: "SIGNED-IN-APP",
    });
    expect(app.request).toHaveBeenCalledWith({
      topic: "own",
      chainId: "stellar:testnet",
      request: { method: "stellar_signXDR", params: { xdr: "UNSIGNED-XDR" } },
    });
    expect(kit.fetchAddress).not.toHaveBeenCalled(); // no new pairing while one is open
  });

  it("connects again when no session holds the account, and refuses another account", async () => {
    const { signWithFreighter } = await load();
    kit.fetchAddress.mockImplementation(async () => {
      app.getSessions.mockResolvedValue([session("t2", `stellar:testnet:${OTHER}`)]);
      return { address: OTHER };
    });
    expect(await signWithFreighter("UNSIGNED-XDR", EXPECTED)).toMatchObject({
      ok: false,
      reason: "wrong_account",
    });
    expect(app.request).not.toHaveBeenCalled();
  });

  it("says the payer cancelled when they reject the request in the app", async () => {
    const { signWithFreighter } = await load();
    app.getSessions.mockResolvedValue([session("own", `stellar:testnet:${OWN}`)]);
    app.request.mockRejectedValue({ code: 5000, message: "User rejected." });
    expect(await signWithFreighter("UNSIGNED-XDR", EXPECTED)).toMatchObject({
      ok: false,
      reason: "cancelled",
    });
  });

  it("says Freighter's app is out of reach when WalletConnect never starts", async () => {
    const { connectFreighter, APP_START_MS } = await load();
    app.isAvailable.mockResolvedValue(false);
    vi.useFakeTimers();
    const result = connectFreighter(NETWORK);
    await vi.advanceTimersByTimeAsync(APP_START_MS + 200);
    expect(await result).toMatchObject({
      ok: false,
      message: expect.stringMatching(/Couldn't reach Freighter's app/),
    });
  });
});
