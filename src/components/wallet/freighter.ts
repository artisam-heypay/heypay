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
