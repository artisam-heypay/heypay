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
