// The browser's side of the payer's own wallet: asks Freighter, through
// StellarWalletsKit, which account it holds and which network it is on.
// Nothing here touches a key; Freighter keeps it.
//
// Freighter is reached one of two ways. In a desktop browser it is the
// extension. Freighter's mobile app has no extension: it opens sites in its own
// browser, marks them with `window.stellar = { provider: "freighter",
// platform: "mobile" }`, and talks to them only over WalletConnect, as it does
// with a phone's own browser. So where the extension isn't found, Freighter is
// reached over WalletConnect instead, when this deployment has a WalletConnect
// project id (NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID). Over WalletConnect the
// payer approves in the app, and the session is opened for HeyPay's network
// only, so the session itself says which network an account is on.
import type { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import type { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import type {
  TWalletConnectModuleParams,
  WalletConnectModule,
  WalletConnectTargetChain,
} from "@creit.tech/stellar-wallets-kit/modules/wallet-connect";
import type { Networks } from "@creit.tech/stellar-wallets-kit/types";

export type FreighterConnection =
  | { ok: true; address: string }
  | { ok: false; reason: "not_installed" | "refused" | "wrong_network"; message: string };

type Kit = typeof StellarWalletsKit;

/** How long WalletConnect has to start before Freighter's app counts as out of reach. */
export const APP_START_MS = 10_000;

/**
 * How long after WalletConnect's window closes the app's answer may still come.
 * The window also closes once the payer has approved in the app.
 */
export const CLOSE_GRACE_MS = 2_000;

const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";

/** Freighter's id in WalletConnect's wallet directory. */
const FREIGHTER_WALLET_ID = "997a355c8f682468706a76cff1b004a7115f505fb962dac54b6e9b442dd1c380";

/** The extension, or Freighter's app over WalletConnect, with the kit set to use it. */
type Reach =
  | { ok: true; via: "extension"; wallets: Kit }
  | { ok: true; via: "app"; wallets: Kit; app: WalletConnectModule; chain: string }
  | { ok: false; message: string };

let kit: Promise<{ wallets: Kit; extension: FreighterModule }> | null = null;
let app: Promise<WalletConnectModule | null> | null = null;

/**
 * The wallets kit with Freighter's extension as its wallet. Loaded on first
 * use, in the browser only: the kit reads the page's storage as soon as it is
 * loaded, and pages that only show the button should not carry it.
 */
function walletKit(): Promise<{ wallets: Kit; extension: FreighterModule }> {
  kit ??= Promise.all([
    import("@creit.tech/stellar-wallets-kit/sdk"),
    import("@creit.tech/stellar-wallets-kit/modules/freighter"),
  ]).then(([{ StellarWalletsKit }, { FreighterModule, FREIGHTER_ID }]) => {
    const extension = new FreighterModule();
    StellarWalletsKit.init({ modules: [extension], selectedWalletId: FREIGHTER_ID });
    return { wallets: StellarWalletsKit, extension };
  });
  return kit;
}

/** True inside Freighter's mobile app, which has no extension to find. */
function inFreighterApp(): boolean {
  const stellar = (window as { stellar?: { provider?: unknown; platform?: unknown } }).stellar;
  return stellar?.provider === "freighter" && stellar?.platform === "mobile";
}

/** WalletConnect's name for HeyPay's network. */
function chainOf(networkPassphrase: string): string {
  return networkPassphrase === PUBLIC_PASSPHRASE ? "stellar:pubnet" : "stellar:testnet";
}

/**
 * Starts WalletConnect, once, and adds it to the kit beside the extension.
 * Null when this deployment has no project id, or WalletConnect can't start
 * (its relay is out of reach). The heavy WalletConnect code loads only here,
 * so a desktop browser with the extension never carries it.
 */
function startApp(
  wallets: Kit,
  extension: FreighterModule,
  networkPassphrase: string,
): Promise<WalletConnectModule | null> {
  const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  if (!projectId) return Promise.resolve(null);
  app ??= import("@creit.tech/stellar-wallets-kit/modules/wallet-connect")
    .then(async ({ WalletConnectModule }) => {
      const bridge = new WalletConnectModule({
        projectId,
        metadata: {
          name: "HeyPay",
          description: "Pay a merchant's QR in pesos from your Stellar wallet.",
          url: window.location.origin,
          icons: [],
        },
        allowedChains: [chainOf(networkPassphrase) as WalletConnectTargetChain],
        // WalletConnect's window offers Freighter alone: HeyPay connects no other wallet.
        appKitOptions: {
          featuredWalletIds: [FREIGHTER_WALLET_ID],
          includeWalletIds: [FREIGHTER_WALLET_ID],
          allWallets: "HIDE",
        } as TWalletConnectModuleParams["appKitOptions"],
      });
      // The module starts its client without saying when it is done.
      const started = Date.now() + APP_START_MS;
      while (!(await bridge.isAvailable())) {
        if (Date.now() >= started) return null;
        await new Promise((r) => setTimeout(r, 100));
      }
      wallets.init({ modules: [extension, bridge], network: networkPassphrase as Networks });
      return bridge;
    })
    .catch(() => null);
  return app;
}

/** The way to Freighter here: the extension when it is found, otherwise the app. */
async function reachFreighter(networkPassphrase: string): Promise<Reach> {
  const { wallets, extension } = await walletKit();
  if (await extension.isAvailable()) {
    wallets.setWallet(extension.productId);
    return { ok: true, via: "extension", wallets };
  }
  const bridge = await startApp(wallets, extension, networkPassphrase);
  if (bridge) {
    wallets.setWallet(bridge.productId);
    return { ok: true, via: "app", wallets, app: bridge, chain: chainOf(networkPassphrase) };
  }
  if (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim()) {
    return {
      ok: false,
      message:
        "Couldn't reach Freighter's app. Check your connection, then reload the page and try again.",
    };
  }
  if (inFreighterApp()) {
    return {
      ok: false,
      message:
        "Freighter's mobile app can't connect to HeyPay yet. " +
        "Use HeyPay in a desktop browser with the Freighter extension.",
    };
  }
  return {
    ok: false,
    message: "Freighter was not found in this browser. Install it, then try again.",
  };
}

/**
 * Pairs with Freighter's app: WalletConnect's window offers to open the app,
 * and the payer approves there. A payer who closes the window without
 * approving has turned it down; without this, the request would wait out
 * WalletConnect's five minutes.
 */
function pairApp(reach: Extract<Reach, { via: "app" }>): Promise<{ address: string }> {
  return new Promise((resolve, reject) => {
    let opened = false;
    let closed: ReturnType<typeof setTimeout> | undefined;
    const stopWatching = reach.app.modal.subscribeState(({ open }) => {
      if (open) opened = true;
      else if (opened && closed === undefined) {
        closed = setTimeout(
          () => reject({ code: -4, message: "Closed without connecting." }),
          CLOSE_GRACE_MS,
        );
      }
    });
    reach.wallets
      .fetchAddress()
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(closed);
        stopWatching();
      });
  });
}

/** The WalletConnect session that holds `address` on HeyPay's network, if one is open. */
async function sessionFor(
  reach: Extract<Reach, { via: "app" }>,
  address: string,
): Promise<string | undefined> {
  const now = Date.now() / 1000;
  const sessions = await reach.app.getSessions();
  return sessions.find(
    (s) => s.expiry > now && s.namespaces.stellar?.accounts.includes(`${reach.chain}:${address}`),
  )?.topic;
}

/**
 * Asks Freighter for the payer's account. Refuses, with the reason, when
 * Freighter can't be reached, when the payer turns the request down, and when
 * Freighter is on another network than HeyPay: an account on the wrong network
 * would sign transactions this one never accepts.
 */
export async function connectFreighter(expected: {
  networkPassphrase: string;
  networkName: string;
}): Promise<FreighterConnection> {
  const reach = await reachFreighter(expected.networkPassphrase);
  if (!reach.ok) return { ok: false, reason: "not_installed", message: reach.message };

  let address: string;
  try {
    ({ address } = reach.via === "app" ? await pairApp(reach) : await reach.wallets.fetchAddress());
  } catch {
    // Turned down, closed without an answer, or locked: no account either way.
    return {
      ok: false,
      reason: "refused",
      message: "Freighter did not share an account. Approve the request in Freighter to connect.",
    };
  }

  const sameNetwork =
    reach.via === "app"
      ? (await sessionFor(reach, address)) !== undefined
      : (await reach.wallets.getNetwork().catch(() => null))?.networkPassphrase ===
        expected.networkPassphrase;
  if (!sameNetwork) {
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

/**
 * Whether Freighter's error says the payer pressed Reject: SEP-43 code -4 from
 * the extension, WalletConnect's 5000 ("User rejected") from the app.
 */
function turnedDown(err: unknown): boolean {
  const { code, message } = (err ?? {}) as { code?: unknown; message?: unknown };
  return (
    code === -4 || code === 5000 || (typeof message === "string" && /reject|declin/i.test(message))
  );
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

function wrongAccount(expected: { address: string }): FreighterSignature {
  return {
    ok: false,
    reason: "wrong_account",
    message:
      `Freighter is on another account, so nothing was sent. ` +
      `In Freighter, switch to ${shortAddress(expected.address)}, the wallet you connected, ` +
      "then try again.",
  };
}

/**
 * Asks Freighter's app to sign over the session that holds the payer's
 * account. With none open (it ended, or the payer connected elsewhere), the
 * payer connects again first, and the account they share must be the one they
 * connected. The request goes to the session found here rather than through
 * the kit, which signs over the first session it ever recorded for an account,
 * even one that has since ended.
 */
async function signInApp(
  reach: Extract<Reach, { via: "app" }>,
  xdr: string,
  expected: { address: string },
): Promise<FreighterSignature> {
  let topic = await sessionFor(reach, expected.address);
  if (!topic) {
    let address: string;
    try {
      ({ address } = await pairApp(reach));
    } catch (err) {
      return unsigned(err);
    }
    if (address !== expected.address) return wrongAccount(expected);
    topic = await sessionFor(reach, address);
    if (!topic) return unsigned(null);
  }

  try {
    const { signedXDR } = await reach.app.signClient.request<{ signedXDR?: string }>({
      topic,
      chainId: reach.chain,
      request: { method: "stellar_signXDR", params: { xdr } },
    });
    return signedXDR ? { ok: true, signedXdr: signedXDR } : unsigned(null);
  } catch (err) {
    return unsigned(err);
  }
}

/**
 * Asks Freighter to sign a transaction with the payer's connected account. The
 * key stays in Freighter: what comes back is the transaction with the
 * signature on it. Refuses first, saying how to put it right in Freighter, when
 * Freighter can't be reached, is on another network than HeyPay, or on another
 * account than the one the transaction is from: a signature from either would
 * only be turned down. Whatever the answer, nothing is sent here.
 */
export async function signWithFreighter(
  xdr: string,
  expected: { address: string; networkPassphrase: string; networkName: string },
): Promise<FreighterSignature> {
  const reach = await reachFreighter(expected.networkPassphrase);
  if (!reach.ok) return { ok: false, reason: "not_installed", message: reach.message };
  if (reach.via === "app") return signInApp(reach, xdr, expected);
  const { wallets } = reach;

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
  if (address !== expected.address) return wrongAccount(expected);

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
