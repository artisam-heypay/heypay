# escrow — HeyPay settlement-escrow contract

Soroban contract that holds a payer's funds under a job id until HeyPay either
releases them to the treasury (payout succeeded) or refunds them to the payer
(payout failed). If HeyPay never acts, the payer can self-refund once the
job's deadline ledger has passed.

## Build and test

```sh
pnpm contract:build   # target/wasm32v1-none/release/escrow.wasm
pnpm contract:test    # cargo test -p escrow
```

Requires the Stellar CLI (`brew install stellar-cli`) and the `wasm32v1-none`
Rust target (`rustup target add wasm32v1-none`).

## Interface

| Function                        | Caller | Effect                                                            |
| ------------------------------- | ------ | ----------------------------------------------------------------- |
| `initialize(admin, token)`      | admin  | One-time setup                                                    |
| `deposit(job_id, from, amount)` | payer  | Locks funds; deadline = now + timeout                             |
| `release(job_id)`               | admin  | Held funds to the admin (treasury)                                |
| `refund(job_id)`                | admin  | Held funds back to the payer                                      |
| `refund_after_timeout(job_id)`  | payer  | Held funds back to the payer, once the deadline ledger is reached |
| `get_job(job_id)`               | anyone | The job's `from`, `amount`, `deadline_ledger`, `status`           |

A job settles exactly once: `release`, `refund` and `refund_after_timeout`
fail with `NotHeld` unless the job is still `Held`.

The full spec exported from the deployed contract is in
[INTERFACE.md](INTERFACE.md).

### Auth rules

- `initialize` requires the `admin` being set to sign, so a deployer cannot
  hand the contract to an account that did not agree to it.
- `deposit` requires `from` (the payer) to sign; the tokens move from `from`.
- `release`, `refund` and `set_timeout` require the stored admin to sign.
- `refund_after_timeout` requires the job's `from` to sign; nobody else can
  trigger it, not even the admin.
- Getters need no signature.

Funds only ever move to two places: the admin (`release`) or the job's payer
(`refund`, `refund_after_timeout`). No function takes a destination address.

### Errors

| Code | Name                 | Returned by                                                                  |
| ---- | -------------------- | ---------------------------------------------------------------------------- |
| 1    | `AlreadyInitialized` | `initialize` a second time                                                   |
| 2    | `NotInitialized`     | any call that needs the admin or token before `initialize`                   |
| 3    | `JobExists`          | `deposit` with a job id already used (held or settled)                       |
| 4    | `JobNotFound`        | `release`, `refund`, `refund_after_timeout`, `get_job` for an unknown job id |
| 5    | `NotHeld`            | `release`, `refund`, `refund_after_timeout` on a job already settled         |
| 6    | `InvalidAmount`      | `deposit` with `amount <= 0`                                                 |
| 7    | `DeadlineNotReached` | `refund_after_timeout` before the job's deadline ledger                      |
| 8    | `InvalidTimeout`     | `set_timeout(0)`                                                             |

A rejected call fails at simulation with `Error(Contract, #<code>)`, so nothing
is sent. The app's client (`src/server/stellar/escrow.ts`) turns the code into
an `EscrowContractError`.

### Deadline and TTL

- `deposit` records `deadline_ledger = current ledger + timeout`. The timeout is
  read when the deposit happens, so `set_timeout` never moves an existing
  job's deadline.
- `refund_after_timeout` works from the deadline ledger onwards (inclusive).
- Every write extends the contract instance's TTL to 30 days once it drops
  below 7 days.
- Each job is a persistent entry kept alive until 30 days past its deadline
  (capped at the network's max TTL), so the payer has time to self-refund
  before the entry can be archived. Settled jobs are kept, not deleted: they
  are the on-chain record, and their id can never be deposited again.

### Events

| Topics                                 | Data                                | Emitted by             |
| -------------------------------------- | ----------------------------------- | ---------------------- |
| `["escrow", "deposit", job_id]`        | `{ from, amount, deadline_ledger }` | `deposit`              |
| `["escrow", "release", job_id]`        | `{ to, amount }`                    | `release`              |
| `["escrow", "refund", job_id]`         | `{ to, amount }`                    | `refund`               |
| `["escrow", "refund_timeout", job_id]` | `{ to, amount }`                    | `refund_after_timeout` |

Each call also emits the token contract's own `transfer` event. Real payloads
from the Testnet run are in [events.sample.json](events.sample.json).

### Release address

`release` pays the admin, not an address passed in the call. The admin is the
HeyPay treasury (`GDZ2…LIN37`), which funds the PHP payout, so releasing to it
is the same money flow as before the escrow. Taking a destination argument
would let a compromised admin key send held funds anywhere; with this design it
can only move them to the treasury or back to the payer.

## In the app

With `ESCROW_ENABLED=true`, the settle job (`src/server/queue/jobs/settle.ts`)
holds the crypto leg of an XLM payment in this contract:

1. `AUTHORIZED → STELLAR_SUBMITTED`: `deposit`, signed by the payer's custodial
   wallet, under job id `sha256(payment.id)` (stored as `Payment.escrowJobId`).
2. `PAYOUT_SUBMITTED → SETTLED`: after Xendit reports the payout paid,
   `release` to the treasury (`Payment.escrowReleaseTxHash`).
3. `REFUND_PENDING → REFUNDED`: after a failed payout, `refund` to the payer
   (`Payment.refundTxHash`).

4. Still held past its deadline ledger: the payer can call
   `refund_after_timeout` from the payment detail drawer or the progress screen
   ("Refund from escrow"), signed by their custodial wallet
   (`Payment.refundTxHash`). HeyPay never makes that call on its own. The
   payment then ends `REFUNDED`.

   A payout the bank is already working on cannot be recalled, so the app
   offers the refund only when the merchant will not be paid as well. At the
   deadline the settle job asks the rail to stop the payout:
   - stopped, or never requested: the payment is cancelled and waits in
     `REFUND_PENDING` for the payer's refund;
   - still in progress: the payer waits for its result, however long it takes
     (`release` if it is paid, `refund` if it fails). The app does not offer
     the timeout refund meanwhile, so the merchant and the payer are never both
     paid for one payment.

   The contract itself places no such condition on `refund_after_timeout`: once
   the deadline ledger has passed, the payer's signature is all it needs. The
   condition is the custodial app's, which holds the payer's key.

A payout is only requested while the escrow still holds the crypto with time
left on it. If the worker was down and comes back after the deadline, or after
the payer took the crypto back, the payment does not go on: no payout is sent.

The payout request and a refund each claim the payment row before they act
(`Payment.payoutRequestedAt`, `Payment.refundSubmittedAt`), and only one of the
two claims can succeed. So a refund and a payout can never both start at the
same moment, and a payer's refund always asks the rail first and goes on only
when the payout is confirmed stopped or failed.

### Known limit: a payout already sent cannot be cancelled

Xendit cancels a payout only while it is `ACCEPTED`, before Xendit has sent it
to the bank or e-wallet (`POST /v2/payouts/{id}/cancel`). Checked in Xendit
test mode on 2026-10-03: a `PH_GCASH` payout was created `ACCEPTED`, and a
cancel one second later was refused with `400 CANCELLATION_NOT_ALLOWED`
("Disbursement cannot be canceled because it has already been processed by
Xendit"); the payout was already `REQUESTED`. Xendit's documentation gives the
same rule for live payouts and names no difference between the two modes. Live
mode has not been tried, since that moves real money.

So in practice the cancel only helps when a payout is waiting at Xendit, for
example while the destination bank is offline. For a payout already sent, the
app waits for the bank's answer instead of refunding, as described above.

`ESCROW_TIMEOUT_LEDGERS` sets the self-refund window from the app: before a
deposit, the settle job calls `set_timeout` if the contract's window differs.
Leave it empty to keep the contract's own window.

USDC payments keep the direct treasury path until the escrow holds USDC (D2).

## Setup

`initialize(admin, token)` runs once. `admin` is the HeyPay operator account
and `token` is the Stellar Asset Contract address of the asset held. Call it
right after deploying, so no one else can initialize the contract first.

### Additions to the SOW interface

- `set_timeout(ledgers)` (admin only) changes the payer self-refund window.
  The default is 17,280 ledgers (~24h). It exists so the timeout-refund demo
  can use a short deadline.
- `admin()`, `token()` and `timeout()` are read-only getters.

## Deploy

```sh
ESCROW_ADMIN=<identity|S...> scripts/escrow-deploy.sh
```

The script builds the WASM, deploys it with the `heypay-deployer` identity
(created and funded with Friendbot on first run), calls
`initialize(admin, native XLM SAC)` in the same run, checks the stored admin,
and prints `ESCROW_CONTRACT_ID=...` for `.env`. See the header of
`scripts/escrow-deploy.sh` for the other variables (`ESCROW_NETWORK`,
`ESCROW_ASSET`, `ESCROW_TOKEN`, `ESCROW_TIMEOUT_LEDGERS`).

One contract holds one token. To hold an issued asset, deploy another instance
with `ESCROW_ASSET=CODE:ISSUER`; the script initializes it with that asset's
Stellar Asset Contract and prints `ESCROW_CONTRACT_ID_<CODE>=...`. The admin
must already trust the asset, or `release` cannot pay it.

In the app, the admin must be the HeyPay treasury: the settle job signs
`release`/`refund` with `HEYPAY_TREASURY_SECRET_ENC`, and `release` pays the
admin.

## Testnet deployment

The app uses this contract (`ESCROW_CONTRACT_ID`). Deployed with
`pnpm escrow:deploy:treasury`.

| Field       | Value                                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract ID | [`CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J`](https://stellar.expert/explorer/testnet/contract/CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J) |
| WASM hash   | `f3ccfe37fa39403a82bc835f18f0b68c83d1503a5d058ec02ae5878143872f60`                                                                                                      |
| Admin       | `GDZ2BQPZQLLXTBFVKJX6UVZQAIZCIC4HDGT4XDLH5JOWO7WWP2KLIN37` (HeyPay treasury)                                                                                            |
| Token       | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` (native XLM SAC)                                                                                             |
| Timeout     | 17,000 ledgers (~23.6h), last set from the app on 2026-10-02 with `ESCROW_TIMEOUT_LEDGERS`; the contract's default is 17,280                                            |
| Deploy tx   | [`c648ec53…`](https://stellar.expert/explorer/testnet/tx/c648ec53da4e7a166499895206597572f4ca065e0b007c521334f19c12e0a217)                                              |
| Init tx     | [`9c18464e…`](https://stellar.expert/explorer/testnet/tx/9c18464e5ea4f1d8bdb3d1ab44350a9b6e117b6aac2170794bef385bd656bc46)                                              |
| Deployed    | 2026-09-29, ledger 4924273                                                                                                                                              |

Read a job:

```sh
stellar contract invoke --id CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J \
  --network testnet --source-account heypay-test-payer --send=no \
  -- get_job --job_id <64 hex chars>
```

### USDC instance

Holds Testnet USDC (`ESCROW_CONTRACT_ID_USDC`). Deployed with
`ESCROW_ASSET=USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 pnpm escrow:deploy:treasury`.
`escrowFor("USDC")` in `src/server/stellar/escrow.ts` returns its client; the
settle job still escrows XLM payments only.

| Field       | Value                                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract ID | [`CAR76EFULGIFGWV4UQIFP5J5GUSRUMBQ3CH4TY5GW4FJCXKDXNYI66EG`](https://stellar.expert/explorer/testnet/contract/CAR76EFULGIFGWV4UQIFP5J5GUSRUMBQ3CH4TY5GW4FJCXKDXNYI66EG) |
| WASM hash   | `f3ccfe37fa39403a82bc835f18f0b68c83d1503a5d058ec02ae5878143872f60` (same as the XLM instance)                                                                           |
| Admin       | `GDZ2BQPZQLLXTBFVKJX6UVZQAIZCIC4HDGT4XDLH5JOWO7WWP2KLIN37` (HeyPay treasury)                                                                                            |
| Token       | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` (SAC of `USDC:GBBD47IF…FLA5`, Circle's testnet issuer)                                                       |
| Timeout     | 17,280 ledgers (~24h), the contract's default                                                                                                                           |
| Deploy tx   | [`d2a14670…`](https://stellar.expert/explorer/testnet/tx/d2a1467037b54bc2e881a9de3b93e9e1c53bb5db0642bf9db52e6dffa29e0f22)                                              |
| Init tx     | [`cf784b7e…`](https://stellar.expert/explorer/testnet/tx/cf784b7e9622c0ad434b7779188fcf120e3eea60a4f8dcf3b1574a7a35444a5c)                                              |
| Deployed    | 2026-10-05, ledger 5034994                                                                                                                                              |

### Other Testnet deployments (same WASM, not used by the app)

| Contract ID                                                                                                                  | Admin                                                | Purpose                                |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------- |
| [`CDGIYVER…LE5E`](https://stellar.expert/explorer/testnet/contract/CDGIYVERJJ7JWIZBHNV3BYGKFOFHNTRAS4XW4KKV4ROTWQAGENI3LE5E) | `GAY7UUSQ…S5RD` (CLI identity `heypay-escrow-admin`) | CLI deposit/release/refund proof below |
| [`CCKUZIXQ…ZD7S`](https://stellar.expert/explorer/testnet/contract/CCKUZIXQJC6CULOKV7B3C5VFCV6AKBCOSHO6PGYRYKZZC7GJVLAZZD7S) | `GCLUI4EI…5TGG` (deployer)                           | Mistaken deploy (empty admin); ignore  |

## Testnet evidence

CLI run on 2026-09-29 against `CDGIYVER…LE5E` (CLI-admin contract above). Payer: `heypay-test-payer`
(`GBUWDVRQOSSD3O4SW5ZGGQB7GSQMMMSLVYAWI5Q5RJ7XSFAZDSOX7P4W`). Job ids are
`sha256` of the label.

| Step       | Job (label)        | Amount | Tx                                                                                                                         |
| ---------- | ------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| deploy     | —                  | —      | [`42393ebc…`](https://stellar.expert/explorer/testnet/tx/42393ebc1cf9d8d8072faa33f553793ee0a6646995e58ad5a41515256b7e8fde) |
| initialize | —                  | —      | [`16af36c5…`](https://stellar.expert/explorer/testnet/tx/16af36c5b57ff77372fcbc860f463e46429f99f7518b08f8b2f1726f45c5fc5c) |
| deposit    | `d1-cli-release-1` | 10 XLM | [`c6eaef66…`](https://stellar.expert/explorer/testnet/tx/c6eaef6692c6c215721469d2a13537a1b9f41f40617d4cc78e66b6d9b9f015b5) |
| release    | `d1-cli-release-1` | 10 XLM | [`eebbc0d8…`](https://stellar.expert/explorer/testnet/tx/eebbc0d815c89218ece50c330db8f9fca4d6b7768ac50ff6e53033ba6fb8282e) |
| deposit    | `d1-cli-refund-1`  | 5 XLM  | [`83706e01…`](https://stellar.expert/explorer/testnet/tx/83706e017492ec92930a4bc8d47135e631fa32e42bc17657f0c358a7825f6282) |
| refund     | `d1-cli-refund-1`  | 5 XLM  | [`a476d1ff…`](https://stellar.expert/explorer/testnet/tx/a476d1ffd2c361a0e19e16fe5d1acb8a4c6f2f75f39b5117476382bc2789a6a9) |

A second `release` of `d1-cli-release-1` fails simulation with
`Error(Contract, #5)` (`NotHeld`), so a job settles once.

### USDC deposit and release (CLI)

CLI run on 2026-10-05 against the USDC instance `CAR76EFU…66EG`. Payer:
`heypay-test-payer`, which first took a USDC trustline and bought USDC on the
DEX. `release` was signed by the treasury, the instance's admin. The job id is
`sha256` of the label.

| Step                | Job (label)             | Amount                    | Tx                                                                                                                         |
| ------------------- | ----------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| change_trust (USDC) | —                       | —                         | [`bd9d1645…`](https://stellar.expert/explorer/testnet/tx/bd9d1645df555018f46f1bfb5e7b1adf2f96de89773201bf562e0cd6f633381f) |
| path payment        | —                       | 10 XLM for 9.4458621 USDC | [`3f8acfd2…`](https://stellar.expert/explorer/testnet/tx/3f8acfd2a71f383cf3530ec73ee5dc17a72108073803d9e3b2faf4ff86f52d72) |
| deposit             | `d2-cli-usdc-release-1` | 1 USDC                    | [`07b2c88d…`](https://stellar.expert/explorer/testnet/tx/07b2c88d57bb51fe12b534190ad38039e6d5195f1888b2721d925ab1e39e9ceb) |
| release             | `d2-cli-usdc-release-1` | 1 USDC                    | [`d095ed96…`](https://stellar.expert/explorer/testnet/tx/d095ed96142ffb30126bab21d5adafbd05a4a0225502afb6ea864e3a457474b1) |

After the release `get_job` reports `Released`, and the treasury's USDC balance
went from 48.0339338 to 49.0339338.

### Forced payout failure (app)

Settle job run on 2026-09-30 against the app contract `CA3IHLNN…BT7J` with
`ESCROW_ENABLED=true`, `PAYMENT_RAIL=mock` and `MOCK_FAIL_PHP_AMOUNT=17.51`:
payment `TXN-DUDFC6FD` deposited into the escrow, the mock payout failed, and
the settle job called the contract's `refund()`. Payer:
`GCH4JXAY2OAFCNVOCRBXGXXHTBQZONWA4L75KSPUSYWSQNTENHJNG4CJ`, job id
`ddea858d10540ee666a124c3c4ea0e44c2c82217c2c43cdce435bb58ce439cb2`
(`sha256(payment.id)`).

| Step    | Amount      | Tx                                                                                                                         |
| ------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| deposit | 5.00001 XLM | [`0a5cf779…`](https://stellar.expert/explorer/testnet/tx/0a5cf779825149d4cba860d29e60bb8b67ecd8cea686392f453bc943a3dbd372) |
| refund  | 5.00001 XLM | [`eb5f7198…`](https://stellar.expert/explorer/testnet/tx/eb5f71982b83946531a8a5fbc6a675e3430574db6ebd1ee3ceb4dd8521187c2d) |

### All four paths from the deployed app

Payments made on the deployed app on 2026-10-02 against the app contract
`CA3IHLNN…BT7J`. Payer: custodial wallet
`GBUJMMGEXDJCSXAT73M7AEMNU5SRXKZ3NAPBYWWYRX2X7COBLWD44ZQF`; treasury (admin):
`GDZ2BQPZ…KLIN37`. Job ids are `sha256(payment.id)`, shortened here.

| Call                   | Job id      | Amount        | Signed by | Tx                                                                                                                         |
| ---------------------- | ----------- | ------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `set_timeout(12)`      | —           | —             | Treasury  | [`f77cc2e4…`](https://stellar.expert/explorer/testnet/tx/f77cc2e4f63225f9ce603528a1589b07556cdd46c67ed4296a34fedca1e9eab3) |
| `deposit`              | `202abb64…` | 0.7228668 XLM | Payer     | [`07660d2f…`](https://stellar.expert/explorer/testnet/tx/07660d2f7bde96829c07112def4af0fed6179f200f2596bb989250d1067b0ef7) |
| `refund_after_timeout` | `202abb64…` | 0.7228668 XLM | Payer     | [`ec4d9fc6…`](https://stellar.expert/explorer/testnet/tx/ec4d9fc63e589226f11b5aebc8f7f1d1a9caab6cbfe595883e81c3acfdbbf2d3) |
| `set_timeout(17000)`   | —           | —             | Treasury  | [`7da39811…`](https://stellar.expert/explorer/testnet/tx/7da398110ff7caa8df4bb3d38319a6476a31f600ffa83869d04f779cce99b1f7) |
| `deposit`              | `28a5d69c…` | 0.2893619 XLM | Payer     | [`0bfca6ae…`](https://stellar.expert/explorer/testnet/tx/0bfca6ae5757df6bb35b89e20113240dbaf8da3590cfa96e56fa060b02208925) |
| `release`              | `28a5d69c…` | 0.2893619 XLM | Treasury  | [`5bd24fb3…`](https://stellar.expert/explorer/testnet/tx/5bd24fb312045bf62c46138daee92f2e56ccfda7917fff7e4ef4af3773dd717c) |
| `deposit`              | `364761ab…` | 5.0028672 XLM | Payer     | [`26f1b40f…`](https://stellar.expert/explorer/testnet/tx/26f1b40f1fca7d17cff1daa851cc020d8dadfc2c1c0c67c673ffcd46a44dc681) |
| `refund`               | `364761ab…` | 5.0028672 XLM | Treasury  | [`397bb0f7…`](https://stellar.expert/explorer/testnet/tx/397bb0f75365823b9b3c69d83f755460da83a31aced9a641e4e1d4c7959ace4a) |

- **Payer timeout refund.** The window was set to 12 ledgers for this run. The
  deposit landed in ledger 4986183, so its deadline was ledger 4986195; the
  payout was still pending, and `refund_after_timeout` landed in
  ledger 4986198, signed by the payer's wallet and not by the admin.
- **Deposit and release.** The payout was accepted and the treasury released
  the held funds 10 seconds after the deposit.
- **Forced payout failure.** Run with `PAYMENT_RAIL=mock` and
  `MOCK_FAIL_PHP_AMOUNT=17.51`: the mock payout failed and the settle job
  called `refund`, returning the funds to the payer.

## License

MIT — see the repository `LICENSE`.
