// The browser's side of the payer's own wallet: asks Freighter, through
// StellarWalletsKit, which account it holds and which network it is on.
// Nothing here touches a key; Freighter keeps it.
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";

export type FreighterConnection =
  | { ok: true; address: string }
  | { ok: false; reason: "not_installed" | "refused" | "wrong_network"; message: string };

let kit: Promise<typeof StellarWalletsKit> | null = null;

/**
 * The wallets kit with Freighter as its one wallet. Loaded on first use, in
 * the browser only: the kit reads the page's storage as soon as it is loaded,
 * and pages that only show the button should not carry it.
 */
function walletKit(): Promise<typeof StellarWalletsKit> {
  kit ??= Promise.all([
    import("@creit.tech/stellar-wallets-kit/sdk"),
    import("@creit.tech/stellar-wallets-kit/modules/freighter"),
  ]).then(([{ StellarWalletsKit }, { FreighterModule, FREIGHTER_ID }]) => {
    StellarWalletsKit.init({ modules: [new FreighterModule()], selectedWalletId: FREIGHTER_ID });
    return StellarWalletsKit;
  });
  return kit;
}

/**
 * Asks Freighter for the payer's account. Refuses, with the reason, when the
 * extension is missing, when the payer turns the request down, and when
 * Freighter is on another network than HeyPay: an account on the wrong network
 * would sign transactions this one never accepts.
 */
export async function connectFreighter(expected: {
  networkPassphrase: string;
  networkName: string;
}): Promise<FreighterConnection> {
  const wallets = await walletKit();

  if (!(await wallets.selectedModule.isAvailable())) {
    return {
      ok: false,
      reason: "not_installed",
      message: "Freighter was not found in this browser. Install it, then try again.",
    };
  }

  let address: string;
  try {
    ({ address } = await wallets.fetchAddress());
  } catch {
    // Turned down, closed without an answer, or locked: no account either way.
    return {
      ok: false,
      reason: "refused",
      message: "Freighter did not share an account. Approve the request in Freighter to connect.",
    };
  }

  const network = await wallets.getNetwork().catch(() => null);
  if (network?.networkPassphrase !== expected.networkPassphrase) {
    return {
      ok: false,
      reason: "wrong_network",
      message:
        `Freighter is not on ${expected.networkName}. ` +
        `Switch its network to ${expected.networkName}, then connect again.`,
    };
  }

  return { ok: true, address };
}

export type FreighterSignature =
  | { ok: true; signedXdr: string }
  | {
      ok: false;
      reason: "not_installed" | "refused" | "wrong_network" | "wrong_account";
      message: string;
    };

/** GABC…WXYZ: enough to recognise an account without filling a phone screen. */
function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * Asks Freighter to sign a transaction with the payer's connected account. The
 * key stays in Freighter: what comes back is the transaction with the
 * signature on it. Refuses first, with the reason, when Freighter is missing,
 * on another network than HeyPay, or on another account than the one the
 * transaction is from: a signature from either would only be turned down.
 */
export async function signWithFreighter(
  xdr: string,
  expected: { address: string; networkPassphrase: string; networkName: string },
): Promise<FreighterSignature> {
  const wallets = await walletKit();

  if (!(await wallets.selectedModule.isAvailable())) {
    return {
      ok: false,
      reason: "not_installed",
      message: "Freighter was not found in this browser. Install it, then try again.",
    };
  }

  const network = await wallets.getNetwork().catch(() => null);
  if (network?.networkPassphrase !== expected.networkPassphrase) {
    return {
      ok: false,
      reason: "wrong_network",
      message:
        `Freighter is not on ${expected.networkName}. ` +
        `Switch its network to ${expected.networkName}, then try again.`,
    };
  }

  const refused: FreighterSignature = {
    ok: false,
    reason: "refused",
    message: "The payment was not approved in Freighter. Nothing was sent.",
  };
  let address: string;
  try {
    ({ address } = await wallets.fetchAddress());
  } catch {
    return refused;
  }
  if (address !== expected.address) {
    return {
      ok: false,
      reason: "wrong_account",
      message:
        `Freighter is on another account. Switch it to ${shortAddress(expected.address)}, ` +
        "the wallet you connected, then try again.",
    };
  }

  try {
    const { signedTxXdr } = await wallets.signTransaction(xdr, {
      networkPassphrase: expected.networkPassphrase,
      address: expected.address,
    });
    return signedTxXdr ? { ok: true, signedXdr: signedTxXdr } : refused;
  } catch {
    // Turned down, closed without an answer, or locked: no signature either way.
    return refused;
  }
}
