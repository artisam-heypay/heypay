# @heypay/settlement-route

Decides, before a payer confirms, whether a Stellar payment in a given asset can
be held, delivered and refunded in that same asset.

A payment in an issued asset such as USDC can fail in ways the network reports
only at submission, after the payer has said yes: the payer or the destination
has no trustline, the escrow contract holds a different token, or the DEX has
no route for a conversion. `resolveSettlementRoute` asks those questions up
front and returns either the route the payment will take or the one reason it
cannot settle.

It is the routing logic of [HeyPay](https://github.com/artisam-heypay/heypay),
which pays Philippine QRPH merchants from a Stellar balance. The package has no
dependencies and reads nothing itself: you supply the checks, so it works with
any Horizon client, any escrow contract and any payout destination.

## Install

The package ships TypeScript source. Inside a pnpm, npm or Yarn workspace, add
it as a workspace dependency and let your bundler compile it (Next.js does this
for workspace packages without configuration). Otherwise copy
[`src/index.ts`](src/index.ts) into your project: it is one file.

## Example

USDC on Testnet, checked through Horizon with `@stellar/stellar-sdk`:

```ts
import { Asset, Horizon } from "@stellar/stellar-sdk";
import { createSettlementRouteResolver } from "@heypay/settlement-route";

type Code = "XLM" | "USDC";

const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const TREASURY = "G..."; // where a settled payment is paid

const stellarAsset = (code: Code) => (code === "XLM" ? Asset.native() : USDC);

/** The account's balance lines, or null when the account does not exist. */
async function balancesOf(account: string) {
  try {
    return (await horizon.loadAccount(account)).balances;
  } catch (e) {
    if ((e as { response?: { status?: number } }).response?.status === 404) return null;
    throw e;
  }
}

/** The balance lines for `code`, whoever issued it. */
async function linesFor(account: string, code: Code) {
  const balances = (await balancesOf(account)) ?? [];
  return balances.flatMap((b) => ("asset_issuer" in b && b.asset_code === code ? [b] : []));
}

export const resolveSettlementRoute = createSettlementRouteResolver<Code, string, Asset>({
  fallbackAsset: "XLM",
  isIssuedAsset: (code) => code !== "XLM",
  getDepositAddress: async () => ({ address: TREASURY, memo: null }),

  async canReceive(account, code) {
    if (code === "XLM") return (await balancesOf(account)) !== null;
    return (await linesFor(account, code)).some((b) => b.asset_issuer === USDC.getIssuer());
  },

  async holdsOtherIssuer(account, code) {
    return (await linesFor(account, code)).some(
      (b) => b.asset_issuer !== USDC.getIssuer() && Number(b.balance) > 0,
    );
  },

  async findStrictSendPaths(from, to, amount) {
    const page = await horizon
      .strictSendPaths(stellarAsset(from), amount, [stellarAsset(to)])
      .call();
    return page.records
      .map((r) => ({
        destAmount: r.destination_amount,
        path: r.path.map((p) =>
          p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code, p.asset_issuer),
        ),
      }))
      .sort((a, b) => Number(b.destAmount) - Number(a.destAmount));
  },

  // No escrow in this example; see "With an escrow" below.
  escrow: { appliesTo: () => false, contractId: () => null, holdsAsset: async () => true },
});

const route = await resolveSettlementRoute({
  asset: "USDC",
  amount: "5.0000000",
  payerPublicKey: "G...",
});

if (!route.ok) {
  // Nothing has moved. Tell the payer what to do about `route.reason`.
} else if (route.route.mode === "direct") {
  // Send USDC to route.route.destination, or deposit it into route.escrowId.
} else {
  // pathPaymentStrictSend along route.route.path; the destination receives XLM.
}
```

## What it returns

A route that can settle:

| `route.mode` | Meaning                                                                                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `direct`     | The payer's asset is delivered as itself, through the escrow named in `escrowId` when there is one.                          |
| `path`       | The destination holds only the fallback asset, so the payment converts on the DEX. `destAmount` and `path` are today's best. |

Or `ok: false` with one `reason`, in the order they are checked:

| `reason`                   | What was found                                                               | What to tell the payer             |
| -------------------------- | ---------------------------------------------------------------------------- | ---------------------------------- |
| `no_escrow`                | The escrow applies to the asset but no instance is deployed for it           | The asset cannot be paid right now |
| `escrow_holds_other_asset` | The instance set for the asset holds a different token                       | Pay with another asset             |
| `payer_no_trustline`       | The payer's account has no trustline for the asset                           | Add the trustline first            |
| `payer_other_issuer`       | No trustline, and the payer holds the same code from another issuer          | That token is not the accepted one |
| `destination_no_trustline` | The destination cannot hold the asset, and it cannot be converted            | Pay with another asset             |
| `no_dex_path`              | The asset would have to be converted and the DEX has no route for the amount | Try a smaller amount               |

`payer_other_issuer` is kept apart from `payer_no_trustline` on purpose. "USDC"
from another issuer is a different asset, so adding the accepted USDC's
trustline would not make it spendable, and a payer told to do that is left
holding a token they can see and cannot use.

## With an escrow

The route is what keeps a payment in one asset from deposit to refund. A
Soroban escrow that takes a token contract at `initialize` holds that one token
for good: whatever it is given, it releases and refunds the same token. The only
way to refund the wrong asset is to send a payment to an instance that holds a
different one, so the resolver checks that first:

```ts
import { Networks } from "@stellar/stellar-sdk";

const ESCROW: Partial<Record<Code, string>> = { USDC: "C..." }; // one instance per asset

escrow: {
  appliesTo: (code) => code in ESCROW,
  contractId: (code) => ESCROW[code] ?? null,
  // Read `token()` from your contract client and compare it with the asset's
  // Stellar Asset Contract on this network.
  holdsAsset: async (code) =>
    (await escrowClient(ESCROW[code]!).token()) === stellarAsset(code).contractId(Networks.TESTNET),
},
```

With an escrow in the route, three rules follow:

- **The payer must hold the asset.** A refund returns the same asset to the
  payer's account, so a payer without the trustline is refused before paying.
- **The destination must hold the asset.** The contract releases its own token,
  so an escrowed payment is never converted on the way: the route is `direct`
  or it is refused with `destination_no_trustline`.
- **One instance per asset.** `contractId(asset)` names the instance and
  `holdsAsset(asset)` proves it holds that asset's token.

## The pattern in HeyPay

The three pieces a USDC payment needs, and where HeyPay implements each:

| Piece              | What happens on-chain                                                                  | In the HeyPay repo                                               |
| ------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| USDC onboarding    | A `change_trust` from the payer's account, once                                        | `establishTrustline` in `src/server/stellar/wallet.ts`           |
| Route check        | Nothing: Horizon and contract reads only                                               | this package, wired in `src/server/payments/settlement-route.ts` |
| Escrow settlement  | `deposit` when the payer confirms, `release` to the treasury once the merchant is paid | `contracts/escrow`, `src/server/queue/jobs/settle.ts`            |
| Asset-safe refunds | `refund`, or the payer's own `refund_after_timeout`, in the token that was deposited   | `contracts/escrow`                                               |

Contract IDs and the Testnet transactions of a settled and a refunded USDC
payment are in [`contracts/escrow/README.md`](../../contracts/escrow/README.md).

## License

MIT. See [LICENSE](LICENSE).
