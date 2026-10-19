// docs/validation/snippets/freighter.ts
//
// Browser only: the payer's own wallet, Freighter, through StellarWalletsKit.
// Swap `signWithKeypair` in 06-sign-with-own-wallet.ts for `signWithFreighter`
// to have the payer approve the deposit in the extension. The key never leaves
// Freighter; what comes back is the same transaction with their signature on it.
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { FREIGHTER_ID, FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";

StellarWalletsKit.init({ modules: [new FreighterModule()], selectedWalletId: FREIGHTER_ID });

/**
 * The payer's account, once they approve sharing it. Refuses an account on
 * another network: anything it signed would be turned down by this one.
 */
export async function connectFreighter(networkPassphrase: string): Promise<string> {
  if (!(await StellarWalletsKit.selectedModule.isAvailable())) {
    throw new Error("Freighter is not installed in this browser");
  }
  const { address } = await StellarWalletsKit.fetchAddress();
  const network = await StellarWalletsKit.getNetwork();
  if (network.networkPassphrase !== networkPassphrase) {
    throw new Error("Freighter is on another network; switch it to Testnet");
  }
  return address;
}

/** Asks Freighter to sign `xdr` with `address`. Nothing is sent. */
export async function signWithFreighter(
  xdr: string,
  expected: { address: string; networkPassphrase: string },
): Promise<string> {
  const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, expected);
  if (!signedTxXdr) throw new Error("Freighter returned no signature");
  return signedTxXdr;
}
