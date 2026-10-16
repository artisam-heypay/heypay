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
      /**
       * `cancelled`: the payer turned the request down. `failed`: Freighter gave
       * no signature for any other reason (locked, closed, an error of its own).
       */
      reason: "not_installed" | "cancelled" | "failed" | "wrong_network" | "wrong_account";
      message: string;
    };

/** GABC…WXYZ: enough to recognise an account without filling a phone screen. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Whether Freighter's error says the payer pressed Reject (SEP-43 code -4). */
function turnedDown(err: unknown): boolean {
  const { code, message } = (err ?? {}) as { code?: unknown; message?: unknown };
  return code === -4 || (typeof message === "string" && /reject|declin/i.test(message));
}

/** No signature came back: the payer said no, or Freighter could not give one. */
function unsigned(err: unknown): FreighterSignature {
  return turnedDown(err)
    ? { ok: false, reason: "cancelled", message: "You cancelled — nothing was sent." }
    : {
        ok: false,
        reason: "failed",
        message: "Freighter did not sign, so nothing was sent. Unlock Freighter, then try again.",
      };
}

/**
 * Asks Freighter to sign a transaction with the payer's connected account. The
 * key stays in Freighter: what comes back is the transaction with the
 * signature on it. Refuses first, saying how to put it right in Freighter, when
 * Freighter is missing, on another network than HeyPay, or on another account
 * than the one the transaction is from: a signature from either would only be
 * turned down. Whatever the answer, nothing is sent here.
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
        `Freighter is on another network, so nothing was sent. ` +
        `In Freighter, switch the network to ${expected.networkName}, then try again.`,
    };
  }

  let address: string;
  try {
    ({ address } = await wallets.fetchAddress());
  } catch (err) {
    return unsigned(err);
  }
  if (address !== expected.address) {
    return {
      ok: false,
      reason: "wrong_account",
      message:
        `Freighter is on another account, so nothing was sent. ` +
        `In Freighter, switch to ${shortAddress(expected.address)}, the wallet you connected, ` +
        "then try again.",
    };
  }

  try {
    const { signedTxXdr } = await wallets.signTransaction(xdr, {
      networkPassphrase: expected.networkPassphrase,
      address: expected.address,
    });
    return signedTxXdr ? { ok: true, signedXdr: signedTxXdr } : unsigned(null);
  } catch (err) {
    return unsigned(err);
  }
}
