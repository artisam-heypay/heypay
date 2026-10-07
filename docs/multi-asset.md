# Multi-asset wallets and payments (XLM + USDT/USDC)

Payers can hold and spend **USDT** (or USDC) in addition to XLM. The merchant is
unaffected: they are still paid **PHP** into their bank account. Only the payer's
funding asset changes.

Implements [#163](https://github.com/webnxt-2030/heypay/issues/163) (receive/hold)
and [#164](https://github.com/webnxt-2030/heypay/issues/164) (pay a QRPH merchant).

## The three facts that shape the design

1. **An issued asset is a `code:issuer` pair.** "USDT" alone means nothing on
   Stellar — anyone can issue an asset with that code. Only the configured
   issuer's USDT is credited; a lookalike from any other issuer is ignored, never
   credited. On **testnet** the issuer defaults to Circle's Centre account
   (below). On **mainnet** there is no default: a wrong issuer there means real
   money sent to a worthless lookalike, so it must be named explicitly.
2. **Receiving requires a trustline.** An account must run `changeTrust` against
   the issuer _before_ it can receive the asset — the network rejects the payment
   otherwise. Each trustline also raises the account's minimum XLM reserve by
   0.5 XLM, so the wallet must hold XLM first.
3. **Fees are always XLM.** Moving USDT still burns an XLM network fee. A USDT
   payment therefore spends two balances: USDT for the amount, XLM for the fee.
   Both are reserved at confirm; a refund returns the USDT but not the spent fee.

## Configuration

| Variable                       | Purpose                                                                   |
| ------------------------------ | ------------------------------------------------------------------------- |
| `PAYMENT_ASSETS`               | Assets the pipeline accepts, e.g. `XLM,USDC,USDT`. Default `XLM`.         |
| `USDT_ASSET_ISSUER`            | Issuer account (`G…`) for USDT. Optional on testnet, required on mainnet. |
| `USDC_ASSET_ISSUER`            | Same, for USDC.                                                           |
| `PDAX_SETTLEMENT_ASSETS`       | `<ASSET>PHP` pairs the rail may trade. Default `XLM`.                     |
| `PDAX_<ASSET>_DEPOSIT_ADDRESS` | Optional. Pins a deposit address instead of resolving it from PDAX.       |
| `MOCK_USDT_PHP_RATE`           | Dev/CI rate for the mock rail (default `58.00`).                          |

An asset is only offered when it is enabled **and** its issuer resolves **and**
the rail can settle it. On mainnet, enabling `USDT` without `USDT_ASSET_ISSUER`
fails loudly the first time the asset is resolved, rather than paying a dead
issuer.

### Testnet issuers (verified against Horizon)

Both codes are issued on testnet by the account whose `home_domain` is
`centre.io` (Circle's Centre Consortium):

```
GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
```

Checked on `horizon-testnet.stellar.org`: it holds **46,242 authorized USDC
trustlines** (the de-facto testnet USDC) and also issues a test **USDT** (11
trustlines). `auth_required` is false, so any wallet may trustline and receive.
This is the default when `*_ASSET_ISSUER` is unset and `STELLAR_NETWORK` is not
`mainnet` — so testnet works with no issuer config at all.

**Caveat found in practice:** wallet swap features (e.g. Freighter's Swap on
testnet) hand out USDT from whatever issuer has DEX liquidity — _not_ Circle's.
A deposit of that USDT is rejected with `op_no_trust`, because the custodial
wallet trusts a different `USDT:issuer` pair. Two consequences:

- The prefund screen now displays the **accepted issuer** for each issued asset,
  with a copy button, so a payer can compare it against the token their own
  wallet holds before sending.
- If your payers acquire USDT via a specific DEX/issuer, point
  `USDT_ASSET_ISSUER` at that issuer instead. **After changing an issuer**, reset
  the stale flags — `UPDATE "WalletBalance" SET "trustlineEstablishedAt"=NULL
WHERE asset='USDT'` — the deposit poller then re-checks the chain and
  establishes the new trustline automatically. The prefund page and
  `/api/wallet/deposit-address` read trustline state from the chain, not the
  cache, precisely so an issuer change cannot hand out an address the network
  would reject.

### PDAX deposit addresses

The Institution rail resolves them at settlement time from
`GET /pdax-institution/v1/crypto/deposit?currency=…`, where the currency carries
the network: `XLM`, `USDCXLM`, `USDTXLM`. The response's `tag` is PDAX's memo for
shared deposit addresses — settlement sends it as the Stellar memo, because
without it PDAX cannot credit the deposit to our account. A pinned
`PDAX_<ASSET>_DEPOSIT_ADDRESS` overrides the lookup and is sent with no memo,
preserving the behaviour the XLM leg has always had.

## Running it locally

One line in `.env` is enough — the testnet issuers above are the defaults:

```bash
PAYMENT_ASSETS=XLM,USDC,USDT
PAYMENT_RAIL=mock                 # the mock rail trades every asset
```

If you would rather control the supply (to fund a payer wallet on demand), mint
your own asset instead and point the issuer var at it:

```bash
node scripts/stellar-issue-test-asset.mjs USDT
# -> prints USDT_ASSET_ISSUER=G... and the issuer secret
```

Then, as a payer: fund the wallet with XLM (needed for the reserve and fees),
open **Prefund**, pick **USDT**, and press **Enable USDT** — that submits the
`changeTrust`. The deposit address appears once the trustline exists. Send USDT
from the issuer account and the deposit poller credits it.

To pay, scan a merchant QR and choose **USDT** on the confirm screen. Switching
asset re-quotes (a quote locks one asset's rate), cancelling the superseded quote.

## PDAX UAT reality check (probed 2026-07-10)

| Pair      | Price  | Min sell qty | Quantity step | PDAX deposit wallet                            |
| --------- | ------ | ------------ | ------------- | ---------------------------------------------- |
| `XLMPHP`  | 7.299  | 10 XLM       | 0.5           | exists, testnet                                |
| `USDCPHP` | 61.677 | 1 USDC       | 0.000001      | address exists but **holds no USDC trustline** |
| `USDTPHP` | 61.34  | 2 USDT       | 0.01          | **none** (`FailedRetrievingWallet`)            |

Consequences, all enforced in code rather than discovered mid-payment:

- **Quoting checks the destination first.** Stellar rejects a payment to an
  account that does not trust the asset — but only at submission, after the payer
  has confirmed. `createQuote` resolves the rail's deposit address and asks
  Horizon whether it can receive the asset, so USDC/USDT fail with "the payment
  rail cannot receive USDC on this network yet" instead of an `op_no_trust`
  transaction failure.
- **Quoting checks the minimum.** Exchanges enforce a minimum _crypto_ order
  size, so the PHP floor moves with the rate. A ₱50 XLM payment is refused with
  "The minimum XLM payment is 10 XLM (about ₱72.99)".
- **The quantity step is per pair.** USDT rejects anything finer than 0.01 with
  `Invalid Quantity Step` (OT010029) — a rejection that would otherwise land
  _after_ the crypto had left the payer's wallet.

## Checking the settlement route at quote time

`resolveSettlementRoute` (`src/server/payments/settlement-route.ts`) runs inside
`createQuote`, after the amount is priced and before anything is saved. It asks
whether the payment can settle, so a payment the network would reject is refused
before the payer confirms instead of failing after their crypto has moved. A
refusal carries a `reason` in the error details and a plain message, which the
scan and confirm screens show as they show any refused quote:

| Reason                     | What was checked                                                                     | Message                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `no_escrow`                | The escrow is on for the asset (`ESCROW_ENABLED`) but its contract ID is not set     | HeyPay cannot hold XLM payments in escrow right now.                                                              |
| `escrow_holds_other_asset` | The escrow instance set for the asset holds a different token                        | This shop is paid in a different currency. Pay with XLM instead.                                                  |
| `payer_no_trustline`       | Horizon shows no trustline for the asset on the payer's wallet                       | Turn on USDC first.                                                                                               |
| `payer_other_issuer`       | No trustline, but the wallet holds the same code from another issuer                 | Your USDC is from a different issuer than the one HeyPay accepts, so it can't be used here. Pay with XLM instead. |
| `destination_no_trustline` | The treasury cannot hold the asset                                                   | This shop is paid in a different currency. Pay with XLM instead.                                                  |
| `no_dex_path`              | The asset would have to be converted to XLM, and the DEX has no route for the amount | USDC cannot be converted for this amount right now. Try a smaller amount or another asset.                        |

Three of these are an **asset mismatch**: the asset being paid is not the asset
that the escrow, the payer's wallet or the treasury deals in. The error details
carry `reason: "asset_mismatch"` with a `cause`. When the mismatch is on
HeyPay's side the payer reads "This shop is paid in a different currency"; when
it is the payer's own asset, the message says so:

- **`escrow`.** An instance holds the token it was initialized with, so a
  contract ID set under the wrong asset (say, the XLM instance in
  `ESCROW_CONTRACT_ID_USDC`) would take XLM from the payer and return XLM in a
  refund. `escrowHoldsAsset` in `src/server/stellar/escrow.ts` reads the
  instance's `token()` and compares it with the asset's Stellar Asset Contract.
  A match is remembered, since the token never changes after `initialize`.
- **`payer_issuer`.** "USDC" from another issuer is a different asset. It shows
  as USDC in other wallets, but HeyPay never credits it and it cannot pay here.
  `walletService.holdsOtherIssuer` looks for it on the payer's account when the
  payment cannot be funded from HeyPay's USDC: when the wallet has no trustline
  for it, and when its balance is short. Such a payer is not told to turn on
  USDC or to add more, which would not help, and not told only that the shop
  is paid in a different currency, which would leave them wondering why the
  USDC they can see is refused. They read: "Your USDC is from a different
  issuer than the one HeyPay accepts, so it can't be used here. Pay with XLM
  instead."
- **`destination`.** The treasury holds no trustline for the asset, so it could
  not be paid. For XLM, which every account takes, a treasury that cannot be
  paid is an outage and keeps the message "HeyPay cannot receive XLM payments
  right now."

When every check passes the route is `direct`: the payer's own asset goes to
the escrow instance named in `escrowId`, or straight to the treasury when the
escrow does not apply, and it stays that asset end to end. The escrow that will
hold the payment is recorded on the `QUOTED` payment event.

The order of these checks and the meaning of each refusal are in the MIT
package [`@heypay/settlement-route`](../packages/settlement-route/README.md),
which has no dependencies and can be reused outside HeyPay.
`src/server/payments/settlement-route.ts` gives it HeyPay's answers: the payout
rail's deposit address, Horizon through the wallet service, the escrow
instances and the DEX path finder.

The resolver also reports a `path` route (convert to XLM on the DEX with
`findStrictSendPaths`) when the destination takes only XLM and the asset is not
escrowed. The settle job does not run converting payments, so `createQuote`
refuses that case as `destination_no_trustline`. An escrowed asset is never
converted: `release` pays the treasury in the escrow's own token, so the
treasury has to hold it.

## Refusals the payer can fix

Three cases are refused before any money moves, each with a message a payer
can act on and a next step on the confirm screen. `paymentRefused`
(`src/server/payments/refusal.ts`) builds the error for the quote and for the
confirm step alike; the reason, the asset and the amounts are in the error
details, and `src/lib/payment-refusal.ts` holds the wording.

| Case                 | Reason                 | Message                                                          | Next step on the confirm screen                   |
| -------------------- | ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| Missing trustline    | `payer_no_trustline`   | Turn on USDC first.                                              | **Turn on USDC** button, then the quote is redone |
| Asset mismatch       | `asset_mismatch`       | This shop is paid in a different currency. Pay with XLM instead. | **Pay with XLM** button                           |
| Insufficient balance | `insufficient_balance` | Not enough USDC — add more or pay with XLM.                      | **Add USDC** link and **Pay with XLM** button     |
| Short network fee    | `insufficient_fee`     | Not enough XLM for the network fee — add about 0.21 XLM.         | **Add XLM** link                                  |

- The quote refuses all four and saves no payment. Balances are compared after
  holds for other payments are taken off.
- An asset mismatch has three causes, listed under
  [Checking the settlement route at quote time](#checking-the-settlement-route-at-quote-time):
  the escrow holds another token, the payer's USDC is from another issuer, or
  the treasury cannot receive the asset.
- The confirm step checks the balances again inside the transaction that takes
  the holds, so a refusal there rolls back and leaves nothing reserved. A
  wallet short of an asset it cannot hold at all is told to turn it on.
- The fee case exists because fees are XLM for every asset: a wallet with
  plenty of USDC still needs the base fee and, when the escrow is on, the
  deposit's fee estimate in XLM.
- **Pay with XLM** is left out when the payment on screen is already the XLM
  one, and for an XLM payment, which has no other asset to fall back on.

## Testnet USDC: issuer, escrow and DEX depth

**Issuer.** Testnet USDC is Circle's testnet issuer
`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (the default above),
not one we mint with `scripts/stellar-issue-test-asset.mjs`. It is the USDC
other testnet wallets hold, the treasury already trusts it, its Stellar Asset
Contract is deployed (`CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`)
and the DEX already has USDC/XLM depth for it. Our own issuer would give a
supply we control, but an asset nobody else holds and an empty order book.

**Escrow.** One escrow holds one token, so USDC has its own instance, set in
`ESCROW_CONTRACT_ID_USDC` (see [contracts/escrow/README.md](../contracts/escrow/README.md)).
`escrowFor(asset)` in `src/server/stellar/escrow.ts` returns the client for an
asset's instance. Changing `USDC_ASSET_ISSUER` needs a new instance, because the
deployed one holds that issuer's USDC only.

With `ESCROW_ENABLED=true` a USDC payment is held by that instance from the
payer's confirmation to the payout's result, and it stays USDC throughout:

- **Deposit.** The settle job deposits the USDC amount, signed by the payer's
  wallet. The escrow holds USDC only, so no fee goes into it.
- **Release.** Once the merchant is paid, the contract pays the treasury in USDC.
- **Refund.** If the payout fails, the contract's `refund` returns the same USDC
  to the payer, and the payer's USDC balance is credited. After the deadline the
  payer can take it back themselves with `refund_after_timeout`. Neither refund
  can come back as XLM: an instance pays out only its own token.
- **Fees.** They are XLM for every asset and are not refunded. The base fee
  (0.00001 XLM) is reserved at confirm as before. The deposit's Soroban fee is
  only known once it lands, so the quote and the confirm step require the
  estimate (`ESCROW_FEE_ESTIMATE_XLM`, 0.2 XLM) to be available in XLM, and the
  real fee is debited afterwards. That fee includes the base fee, so the two
  XLM entries add up to what the chain charged (0.0652119 XLM on Testnet).
- **Stuck refunds.** A refund that did not finish stays `REFUND_PENDING`; the
  reconcile job runs the settle job again, which asks the same instance.

The hashes of a settled and a refunded USDC payment are in
[contracts/escrow/README.md](../contracts/escrow/README.md#usdc-payments-from-the-settle-job).
USDT has no escrow instance and still goes straight to the treasury.

**DEX depth.** `node scripts/seed-dex-offers.mjs` prints the USDC/XLM order book
and the best strict-send route in each direction, and exits 1 when 10 XLM to
USDC or 1 USDC to XLM has no route. Checked on 2026-10-05:

| Spend   | Receives        | Route    |
| ------- | --------------- | -------- |
| 1 XLM   | 0.9445860 USDC  | direct   |
| 10 XLM  | 9.4458598 USDC  | direct   |
| 100 XLM | 94.4584942 USDC | direct   |
| 1 USDC  | 6.9753911 XLM   | direct   |
| 10 USDC | 60.8939227 XLM  | via LUSD |

Routes exist both ways at every size, so nothing was seeded. The two directions
do not agree on a price (about 1.06 XLM per USDC one way, 6 to 7 the other):
testnet liquidity is whatever was last posted, not a market. That is enough to
show a swap and to pass the route check, and it is why a payment is priced from
the rate source and never from the DEX.

If the book goes thin, seed it from an account HeyPay controls:

```bash
DEX_SEED_SECRET=S... node scripts/seed-dex-offers.mjs --seed --price 8 --amount 50
DEX_SEED_SECRET=S... node scripts/seed-dex-offers.mjs --remove   # take them down again
```

`--seed` places a sell and a buy offer for the amount, 1% either side of
`--price` (XLM per USDC). The account needs a USDC trustline, that much USDC and
the XLM to buy as much again. The CLI identity `heypay-test-payer`
(`GBUWDVRQOSSD3O4SW5ZGGQB7GSQMMMSLVYAWI5Q5RJ7XSFAZDSOX7P4W`) is set up for it:
it holds a USDC trustline and about 8 USDC bought on the DEX. The script was
run once on 2026-10-05 with 1 USDC offers, placed in
[`c86ea82b…`](https://stellar.expert/explorer/testnet/tx/c86ea82b2bcf19ce7314a3c378a82a14ab80299a01c9a7544fb1e50ba33bb1e2)
and removed in
[`8373f408…`](https://stellar.expert/explorer/testnet/tx/8373f408faec8921ccbdf309fa265eafd917761340c53982c8ca157182311f84);
no HeyPay offers are open now.

## Swapping XLM and USDC

The **Swap** page (`/payer/swap`, linked from the dashboard once USDC is an
enabled asset) converts XLM to USDC or USDC to XLM inside the payer's own
wallet. A swap is one path payment from the wallet to itself, filled on the
Stellar DEX; nothing passes through the treasury or the escrow. A wallet without
the USDC trustline is shown the **Turn on USDC** card in place of the form.

The payer types an amount of the asset they are giving up and sees a quote that
is asked for again every 15 seconds. The two directions use the two kinds of
path payment:

| Direction   | Operation                     | What is fixed                         | What the quote shows                  |
| ----------- | ----------------------------- | ------------------------------------- | ------------------------------------- |
| XLM to USDC | `path_payment_strict_send`    | The XLM spent: exactly what was typed | "You get about", "Minimum received"   |
| USDC to XLM | `path_payment_strict_receive` | The XLM received: exactly the minimum | "You pay at most", "Minimum received" |

The minimum is the DEX's current answer for the amount (`findStrictSendPaths`)
less 1%, rounded down. Confirming sends the two numbers the payer saw, the most
to spend and the least to receive, and `executeSwap`
(`src/server/payer/swap.ts`) looks for a route that still honours them. If the
DEX no longer offers that, the swap is refused with "The price changed" and a
new quote, and no transaction is sent. A strict receive delivers exactly the
minimum and spends only the USDC that takes, so a little of what was typed can
stay in the wallet.

Balances are a ledger, so a swap is written into it the way a payment is:

- The amount and the 0.00001 XLM fee are held before the transaction is sent.
- XLM the network keeps locked (the account's minimum balance, 1.5 XLM with a
  USDC trustline, plus anything its open offers are selling) cannot be swapped.
  The network would refuse it only after charging the fee, so it is refused
  first, with the most that can be swapped.
- What moved is read back from Horizon, since a strict send can deliver more
  than its minimum and a strict receive can spend less than its maximum. Three
  `SWAP` entries record it: what was spent, what was received, and the fee. The
  transaction hash is unique on `WalletTransaction`, so the first entry carries
  it and the other two name it in their memo.
- A swap the network took and failed (the price moved in the seconds between
  the check and the ledger) converted nothing but was charged the fee. One
  `SWAP` entry debits that fee, so the wallet's XLM still matches the chain.
- A swap that never reached a ledger frees its holds and records nothing. If
  Horizon cannot say whether it went through, the holds stay and the error is
  reported, so the wallet cannot spend what the swap may have spent.

**Recent swaps** on the page lists each swap with both amounts and a link to its
transaction on Stellar Expert; `GET /api/wallet/transactions` returns the same
entries.

Both directions on Testnet, swapped on the page at phone width on 2026-10-07
from wallet `GA6TYZN5ZKWWCHD3G2VTPFRBO7B7HQBJYHWYXR45YM553TIXQ6BPVI53`:

| Direction   | Spent          | Received       | Transaction                                                                                                                                 |
| ----------- | -------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| XLM to USDC | 10.0000000 XLM | 9.4243887 USDC | [`3d8f0cd5…`](https://stellar.expert/explorer/testnet/tx/3d8f0cd56c3168712d2fef7c2b17dfdd2ab93c5e9dc0c47c1008369a9f4e1b23) (strict send)    |
| USDC to XLM | 0.9900000 USDC | 6.0284982 XLM  | [`bd9e350d…`](https://stellar.expert/explorer/testnet/tx/bd9e350d8b5ac134470c7b950b01987eb9832b46d76849f2cba7c43291e05cc1) (strict receive) |

The wallet's `change_trust` for USDC is
[`7452b4ce…`](https://stellar.expert/explorer/testnet/tx/7452b4ce765d2ce4ab0b01bd02a8ac0168c701551b837dc62bd68f4439755e40).
The two prices differ for the reason given under
[DEX depth](#testnet-usdc-issuer-escrow-and-dex-depth): Testnet liquidity is
whatever was last posted.

The same pair was run through `executeSwap` from a script, from wallet
`GAOWUQ2DS63B6UJUIXRUURS5GPWJ57O3SBC7N5N2B77R2RRW4MAKC3G5`
([`62a8306f…`](https://stellar.expert/explorer/testnet/tx/62a8306fadce116d7c813f9bd8d972516bbfa7a42754a39e1691936b0654e61d),
[`5bf3a735…`](https://stellar.expert/explorer/testnet/tx/5bf3a735367b9c5f56e7fe2a0f1ced3425e64d2e56627a3753617135127d8848)),
to compare the ledger with the chain afterwards. They agreed to the stroop:
9996.0284682 XLM and 8.4343933 USDC.

## Trustlines are automatic

Stellar cannot be talked out of requiring a trustline: the network rejects an
untrusted incoming payment. A custodial wallet can, however, add the trustline on
the payer's behalf, and does — `syncWalletDeposits` establishes any missing
trustline for an enabled asset as soon as the wallet holds enough XLM to cover
the extra 0.5 XLM reserve. So most payers never have to press anything; the
manual `POST /api/wallet/trustline` remains for an unfunded wallet that has just
been topped up.

The payer sees this as a **Turn on USDC** card, on Prefund (when USDC is picked)
and on Settings. While the trustline is missing it explains the step in one line
and offers the button. Once it exists, however it was created, the card reads
"USDC is on" with no button, and links to the `change_trust` transaction on
Stellar Expert. That hash is kept in `WalletBalance.trustlineTxHash` for both
the manual and the automatic path; a trustline that already existed on-chain
before HeyPay saw it has no hash and shows no link.

### On from sign-up, on a sponsored reserve

With `WALLET_SPONSOR_SECRET_ENC` set, a new payer does not wait to be funded.
Sign-up queues a `wallet-activate` job, and the worker sends one transaction
from the sponsor account that creates the wallet's account and adds the
trustline of every enabled issued asset inside a sponsorship
(`begin_sponsoring_future_reserves` … `end_sponsoring_future_reserves`), signed
by the sponsor and the wallet.

The reserve the network asks for, 1 XLM for the account and 0.5 XLM for each
trustline, stays locked in the sponsor's balance. The wallet is created with
0 XLM, so the reserve is not in the payer's balance, on-chain or in HeyPay, and
the payer cannot spend it. What the payer deposits later is all theirs to
spend: none of it is held back as a minimum balance. The sponsor also pays the
fee.

The job runs one at a time (one sponsor account, one sequence number), is
retried by the queue, and does nothing for an account that already holds its
trustlines. If it never succeeds, the wallet falls back to the path above.
Wallets created before the variable was set are not touched. `pnpm
wallet:sponsor status` shows how much of the sponsor's XLM is still free.

## Deploying it

Same variables. The two that need real answers before enabling USDT on mainnet:

- **A verified issuer.** Tether's native Stellar USDT has been intermittent.
  Confirm a live issuer on stellar.expert before setting `USDT_ASSET_ISSUER`, or
  ship **USDC** instead — same mechanism, one env var different — which is
  well-supported on Stellar.
- **The `<ASSET>PHP` pair.** Pair availability is account-specific. All three
  were confirmed live against the PDAX UAT sandbox (`XLM` 7.299, `USDC` 61.677,
  `USDT` 61.34). An asset left out of `PDAX_SETTLEMENT_ASSETS` is still
  receivable and holdable (#163) — quoting a payment in it is refused with a 400
  rather than opening a trade that cannot be settled.
- **Per-pair minimum trade size.** PDAX prices `XLMPHP` and `USDCPHP` from ₱100
  but rejects `USDTPHP` below roughly ₱500. `getAssetRate` therefore escalates
  its probe (₱100 → ₱500 → ₱2000) instead of reporting a pair as unpriceable the
  moment a ₱100 quote is refused.

The DEX path-payment settlement route (strategy B from #164, described above
under [Settling an asset the rail cannot take](#settling-an-asset-the-rail-cannot-take))
is already implemented and covers this — mainnet needs the same route, real
liquidity, and the guards in that section, not new code.

## Holdings

`getHoldings` (`src/server/payer/holdings.ts`) is the payer's portfolio: every
enabled token, its balance, its PHP value, and the total. A token whose pair the
rail cannot price keeps its balance but has a null value and is **excluded from
the total** — counting an unpriced balance as ₱0 would understate the total. The
dashboard shows the caveat whenever that happens.

## Storage

Native XLM stays on `CustodialWallet.cachedXlmBalance` / `reservedXlm`, where it
has always lived. Issued assets get a row per `(wallet, asset)` in
`WalletBalance`, which also records `trustlineEstablishedAt`.
`src/server/wallet/balances.ts` is the single accessor presenting both behind one
asset-keyed API, so the XLM pipeline and its ledger history are unchanged.

`Payment.amountAsset` and `WalletTransaction.amount` are denominated in their
row's `asset`; both reuse the old `amountXlm` column, since every pre-existing row
is XLM. `Payment.networkFeeXlm` remains XLM by definition.

## Tests

- `tests/server/stellar/assets.test.ts` — issuer resolution, impostor rejection.
- `tests/integration/wallet-trustline.test.ts` — trustline API, reserve check.
- `src/server/payments/quote.test.ts` — USDT quoting, per-asset balance checks,
  and the USDC edge cases (missing trustline, asset mismatch, insufficient
  balance), each with nothing saved or held.
- `src/server/payments/confirm.test.ts` — the same refusals at confirm.
- `src/components/payer/ConfirmPayment.test.tsx` — the message and the next step
  the confirm screen shows for each.
- `src/server/payer/swap.test.ts` — swap quotes, both directions, the refusals,
  and the ledger after a swap that worked, failed or could not be confirmed.
- `src/components/payer/SwapPanel.test.tsx` — the Turn on USDC card, the live
  quote in each direction and the link to the transaction.
- `src/server/queue/jobs/settle.test.ts` — USDT settlement, split debits, refunds;
  USDC held, released and refunded by the USDC escrow.
- `tests/server/rails/pdax-insti.test.ts` — deposit-address lookup, tag-as-memo,
  USDC quoting and per-pair quantity steps.
- `tests/server/stellar/usdt.integration.test.ts` — **live testnet**: mint, trust,
  receive, reject an impostor, trust the real USDC/USDT issuers, send. Run with:

```bash
RUN_STELLAR_IT=1 STELLAR_NETWORK=testnet npx vitest run tests/server/stellar/usdt.integration.test.ts
```
