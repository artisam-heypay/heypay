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
   credited. Issuers therefore come from config (`USDT_ASSET_ISSUER`) and are
   never hardcoded, because they differ per network and the canonical mainnet
   issuer must be verified before you point real money at it.
2. **Receiving requires a trustline.** An account must run `changeTrust` against
   the issuer _before_ it can receive the asset — the network rejects the payment
   otherwise. Each trustline also raises the account's minimum XLM reserve by
   0.5 XLM, so the wallet must hold XLM first.
3. **Fees are always XLM.** Moving USDT still burns an XLM network fee. A USDT
   payment therefore spends two balances: USDT for the amount, XLM for the fee.
   Both are reserved at confirm; a refund returns the USDT but not the spent fee.

## Configuration

| Variable                    | Purpose                                                      |
| --------------------------- | ------------------------------------------------------------ |
| `PAYMENT_ASSETS`            | Assets the pipeline accepts, e.g. `XLM,USDT`. Default `XLM`. |
| `USDT_ASSET_ISSUER`         | Issuer account (`G…`) for USDT on the configured network.    |
| `USDC_ASSET_ISSUER`         | Same, for USDC.                                              |
| `PDAX_SETTLEMENT_ASSETS`    | `<ASSET>PHP` pairs the rail may trade. Default `XLM`.        |
| `PDAX_USDT_DEPOSIT_ADDRESS` | Where settlement sends the payer's USDT before selling it.   |
| `MOCK_USDT_PHP_RATE`        | Dev/CI rate for the mock rail (default `58.00`).             |

An asset is only offered when it is enabled **and** its issuer is configured
**and** the rail can settle it. Enabling `USDT` without `USDT_ASSET_ISSUER` fails
loudly the first time the asset is resolved, rather than paying a dead issuer.

## Running it locally

Stellar testnet has no canonical USDT issuer, so mint your own:

```bash
node scripts/stellar-issue-test-asset.mjs USDT
```

It prints an issuer account. Put it in `.env`:

```bash
PAYMENT_ASSETS=XLM,USDT
USDT_ASSET_ISSUER=G...            # from the script
PDAX_USDT_DEPOSIT_ADDRESS=G...    # any testnet account you control
PAYMENT_RAIL=mock                 # the mock rail trades every asset
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
- **A PDAX `USDTPHP` pair.** Pair availability is account-specific. If PDAX
  cannot sell USDT for PHP, leave it out of `PDAX_SETTLEMENT_ASSETS`: the wallet
  will still receive and hold USDT (#163), but quoting a USDT payment is refused
  with a 400 rather than opening a trade that cannot be settled.

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
- `tests/server/stellar/usdt.integration.test.ts` — **live testnet**: mint, trust,
  receive, reject an impostor, send. Run with:

```bash
RUN_STELLAR_IT=1 STELLAR_NETWORK=testnet npx vitest run tests/server/stellar/usdt.integration.test.ts
```
