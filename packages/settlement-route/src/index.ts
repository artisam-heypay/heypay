// @heypay/settlement-route
//
// Whether a payment in a given asset can settle, decided at quote time.
//
// Everything checked here is something the network would otherwise refuse only
// after the payer has confirmed, or would get wrong: an escrow that is not
// deployed for the asset or holds a different one, a payer account that could
// not take the asset back in a refund, a destination that cannot hold the
// asset, or a DEX with no route when the asset would have to be converted on
// the way.
//
// The resolver holds the order of the checks and what each failure means. It
// reads nothing itself: the caller supplies the checks, so it runs against any
// Horizon client, escrow contract and payout destination.

export type RouteRefusal =
  /** The escrow is on for this asset but no instance is deployed for it. */
  | "no_escrow"
  /** The escrow instance set for this asset holds a different one. */
  | "escrow_holds_other_asset"
  /** The payer's account holds no trustline for the asset. */
  | "payer_no_trustline"
  /** No trustline for the asset, but the payer holds its code from another issuer. */
  | "payer_other_issuer"
  /** The destination cannot hold the asset, and converting it is not possible. */
  | "destination_no_trustline"
  /** The asset would have to be converted, and the DEX has no route for the amount. */
  | "no_dex_path";

export type SettlementPath<A extends string = string, Amount = string, Hop = unknown> =
  | {
      /** The destination receives the payer's own asset. */
      mode: "direct";
      settlementAsset: A;
      destination: string;
      memo: string | null;
    }
  | {
      /** The asset is converted on the DEX in the transaction that delivers it. */
      mode: "path";
      settlementAsset: A;
      destination: string;
      memo: string | null;
      /** How much of `settlementAsset` the amount buys along `path` right now. */
      destAmount: Amount;
      path: Hop[];
    };

export type SettlementRoute<A extends string = string, Amount = string, Hop = unknown> =
  | { ok: true; reason: null; escrowId: string | null; route: SettlementPath<A, Amount, Hop> }
  | { ok: false; reason: RouteRefusal; escrowId: string | null; route: null };

/** A DEX route that spends a fixed amount, as `findStrictSendPaths` reports it. */
export type StrictSendRoute<Amount = string, Hop = unknown> = {
  /** How much of the destination asset the amount buys along this route. */
  destAmount: Amount;
  /** Intermediate hops, excluding source and destination. Empty for a direct trade. */
  path: Hop[];
};

/**
 * What the resolver asks about the network and the deployment. `A` is the
 * caller's asset type (codes such as "XLM" and "USDC"), `Amount` its amount
 * type and `Hop` one intermediate asset of a DEX path.
 */
export type SettlementRouteChecks<A extends string = string, Amount = string, Hop = unknown> = {
  /** The asset every destination can receive: on Stellar, any existing account accepts XLM. */
  fallbackAsset: A;
  /** True for an asset that needs a trustline before an account can hold it. */
  isIssuedAsset(asset: A): boolean;
  /** Where a settled payment in `asset` is paid, and the memo that destination needs. */
  getDepositAddress(asset: A): Promise<{ address: string; memo: string | null }>;
  /** Whether `account` exists and, for an issued asset, trusts its issuer. */
  canReceive(account: string, asset: A): Promise<boolean>;
  /** Whether `account` holds an asset with `asset`'s code from another issuer. */
  holdsOtherIssuer(account: string, asset: A): Promise<boolean>;
  /** Routes that spend exactly `amount` of `from` and deliver `to`, the best first. */
  findStrictSendPaths(from: A, to: A, amount: Amount): Promise<StrictSendRoute<Amount, Hop>[]>;
  escrow: {
    /** Whether a payment in `asset` is held by an escrow contract at all. */
    appliesTo(asset: A): boolean;
    /** The escrow instance deployed for `asset`, or null when there is none. */
    contractId(asset: A): string | null;
    /** Whether that instance holds `asset`'s own token, so a refund returns the same asset. */
    holdsAsset(asset: A): Promise<boolean>;
  };
};

export type SettlementRouteInput<A extends string = string, Amount = string> = {
  asset: A;
  /** How much of `asset` the payer sends. */
  amount: Amount;
  payerPublicKey: string;
};

/**
 * Builds `resolveSettlementRoute` over the given checks: how `amount` of
 * `asset` from `payerPublicKey` would settle, or why it cannot. `escrowId` is
 * the contract that holds the crypto until the payout is known, or null when
 * the payment goes straight to the destination.
 */
export function createSettlementRouteResolver<
  A extends string = string,
  Amount = string,
  Hop = unknown,
>(
  checks: SettlementRouteChecks<A, Amount, Hop>,
): (input: SettlementRouteInput<A, Amount>) => Promise<SettlementRoute<A, Amount, Hop>> {
  return async function resolveSettlementRoute({ asset, amount, payerPublicKey }) {
    let escrowId: string | null = null;
    const refuse = (reason: RouteRefusal): SettlementRoute<A, Amount, Hop> => ({
      ok: false,
      reason,
      escrowId,
      route: null,
    });

    if (checks.escrow.appliesTo(asset)) {
      escrowId = checks.escrow.contractId(asset);
      if (!escrowId) return refuse("no_escrow");
      // The payment must be held, released and refunded in the asset it was paid in.
      if (!(await checks.escrow.holdsAsset(asset))) return refuse("escrow_holds_other_asset");
    }

    const deposit = await checks.getDepositAddress(asset);
    const [payerHolds, destinationHolds] = await Promise.all([
      // A refund returns the same asset, so the payer must still be able to hold it.
      checks.isIssuedAsset(asset) ? checks.canReceive(payerPublicKey, asset) : true,
      checks.canReceive(deposit.address, asset),
    ]);
    if (!payerHolds) {
      // The same code from another issuer is a different asset. Adding the
      // accepted one's trustline would not make it spendable, so the payer is
      // not sent to do that.
      const lookalike = await checks.holdsOtherIssuer(payerPublicKey, asset);
      return refuse(lookalike ? "payer_other_issuer" : "payer_no_trustline");
    }
    if (destinationHolds) {
      return {
        ok: true,
        reason: null,
        escrowId,
        route: {
          mode: "direct",
          settlementAsset: asset,
          destination: deposit.address,
          memo: deposit.memo,
        },
      };
    }

    // The escrow releases its own token to the destination, so an escrowed asset
    // cannot be converted on the way: the destination has to hold it.
    const fallback = checks.fallbackAsset;
    if (escrowId || asset === fallback) return refuse("destination_no_trustline");
    if (!(await checks.canReceive(deposit.address, fallback))) {
      return refuse("destination_no_trustline");
    }
    const [best] = await checks.findStrictSendPaths(asset, fallback, amount);
    if (!best) return refuse("no_dex_path");
    return {
      ok: true,
      reason: null,
      escrowId,
      route: {
        mode: "path",
        settlementAsset: fallback,
        destination: deposit.address,
        memo: deposit.memo,
        destAmount: best.destAmount,
        path: best.path,
      },
    };
  };
}
