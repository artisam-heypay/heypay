// Public block-explorer links for Stellar transactions, so payers and merchants can
// verify a payment on-chain themselves rather than trusting HeyPay's word for it.

/** stellar.expert link for `hash` on the network the app runs against. */
export function stellarTxUrl(
  hash: string,
  network: string | undefined = process.env.STELLAR_NETWORK,
): string {
  const net = network === "mainnet" || network === "public" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${net}/tx/${encodeURIComponent(hash)}`;
}
