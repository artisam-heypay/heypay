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

## Deploying it

Same variables. The two that need real answers before enabling USDT on mainnet:

- **A verified issuer.** Tether's native Stellar USDT has been intermittent.
  Confirm a live issuer on stellar.expert before setting `USDT_ASSET_ISSUER`, or
  ship **USDC** instead — same mechanism, one env var different — which is
  well-supported on Stellar.
- **The `<ASSET>PHP` pair.** Pair availability is account-specific. PDAX's
  Institution API documents `quote_currency=USDC` against `base_currency=PHP`,
  so USDC is the safe choice; confirm `USDT/PHP` with your relationship manager.
  An asset left out of `PDAX_SETTLEMENT_ASSETS` is still receivable and holdable
  (#163) — quoting a payment in it is refused with a 400 rather than opening a
  trade that cannot be settled.

The alternative settlement route considered in #164 — converting USDT→XLM on the
Stellar DEX with a path payment, then running the existing XLM sell — is not
implemented. `PaymentRailProvider.supportsAsset` is the seam where it would go.

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
- `src/server/payments/quote.test.ts` — USDT quoting, per-asset balance checks.
- `src/server/queue/jobs/settle.test.ts` — USDT settlement, split debits, refunds.
- `tests/server/rails/pdax-insti.test.ts` — deposit-address lookup, tag-as-memo,
  USDC quoting and per-pair quantity steps.
- `tests/server/stellar/usdt.integration.test.ts` — **live testnet**: mint, trust,
  receive, reject an impostor, trust the real USDC/USDT issuers, send. Run with:

```bash
RUN_STELLAR_IT=1 STELLAR_NETWORK=testnet npx vitest run tests/server/stellar/usdt.integration.test.ts
```
