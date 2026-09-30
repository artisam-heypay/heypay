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
`ESCROW_TOKEN`, `ESCROW_TIMEOUT_LEDGERS`).

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
| Timeout     | 17,280 ledgers (default, ~24h)                                                                                                                                          |
| Deploy tx   | [`c648ec53…`](https://stellar.expert/explorer/testnet/tx/c648ec53da4e7a166499895206597572f4ca065e0b007c521334f19c12e0a217)                                              |
| Init tx     | [`9c18464e…`](https://stellar.expert/explorer/testnet/tx/9c18464e5ea4f1d8bdb3d1ab44350a9b6e117b6aac2170794bef385bd656bc46)                                              |
| Deployed    | 2026-09-29, ledger 4924273                                                                                                                                              |

Read a job:

```sh
stellar contract invoke --id CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J \
  --network testnet --source-account heypay-test-payer --send=no \
  -- get_job --job_id <64 hex chars>
```

### Other Testnet deployments (same WASM, not used by the app)

| Contract ID                                                                                                                  | Admin                                                | Purpose                                |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------- |
| [`CDGIYVER…LE5E`](https://stellar.expert/explorer/testnet/contract/CDGIYVERJJ7JWIZBHNV3BYGKFOFHNTRAS4XW4KKV4ROTWQAGENI3LE5E) | `GAY7UUSQ…S5RD` (CLI identity `heypay-escrow-admin`) | CLI deposit/release/refund proof below |
| [`CCKUZIXQ…ZD7S`](https://stellar.expert/explorer/testnet/contract/CCKUZIXQJC6CULOKV7B3C5VFCV6AKBCOSHO6PGYRYKZZC7GJVLAZZD7S) | `GCLUI4EI…5TGG` (deployer)                           | Mistaken deploy (empty admin); ignore  |

## Testnet evidence (draft)

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

Still to come: an on-chain `refund()` from a forced payout failure (app) and a
payer-called `refund_after_timeout()` after an expired deadline.

## License

MIT — see the repository `LICENSE`.
