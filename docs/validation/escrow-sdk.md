# Escrow SDK and API reference

How to call HeyPay's settlement escrow from TypeScript, from the contract up to
the HTTP API a payer's own wallet uses. For worked examples you can copy and
run, see the [integration guide](integration-guide.md).

There are four layers. Use the lowest one that fits:

| Layer                                           | Where                                                                                                                            | Use it to                                               |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [Contract](#contract)                           | `contracts/escrow`, deployed on Testnet                                                                                          | Call the escrow from any language or the Stellar CLI    |
| [TypeScript client](#typescript-client)         | `src/server/stellar/escrow-bindings`                                                                                             | Call it from Node or a browser with typed arguments     |
| [HeyPay server wrapper](#heypay-server-wrapper) | `src/server/stellar/escrow.ts`, `src/server/stellar/escrow-config.ts`                                                            | See how HeyPay runs it: custodial signing, errors, fees |
| [Own-wallet API](#own-wallet-api)               | `src/lib/client/escrow-*.ts`, `POST /api/payments/:id/{prepare,signed}`, `POST /api/payments/:id/escrow-refund/{prepare,signed}` | Have a payer sign a deposit or refund in Freighter      |

Reference files:

- [`contracts/escrow/INTERFACE.md`](../../contracts/escrow/INTERFACE.md): the
  full spec exported from the deployed contract (functions, `Job`, `JobStatus`,
  `Error`, events).
- [`contracts/escrow/events.sample.json`](../../contracts/escrow/events.sample.json):
  real event payloads from Testnet.
- [`contracts/escrow/README.md`](../../contracts/escrow/README.md): auth rules,
  deadline and TTL, deployments and Testnet evidence.
- WASM: `escrow.wasm` in release
  [`escrow-v0.3`](https://github.com/artisam-heypay/heypay/releases/tag/escrow-v0.3),
  WASM hash `f3ccfe37fa39403a82bc835f18f0b68c83d1503a5d058ec02ae5878143872f60`.

## Contract

| Contract ID                                                                                                                  | Holds                                               | Admin                        |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------- |
| [`CA3IHLNN…BT7J`](https://stellar.expert/explorer/testnet/contract/CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J) | native XLM (SAC `CDLZFC3S…CYSC`)                    | HeyPay treasury `GDZ2…LIN37` |
| [`CAR76EFU…66EG`](https://stellar.expert/explorer/testnet/contract/CAR76EFULGIFGWV4UQIFP5J5GUSRUMBQ3CH4TY5GW4FJCXKDXNYI66EG) | Testnet USDC (SAC `CBIELTK6…DAMA`, Circle's issuer) | HeyPay treasury `GDZ2…LIN37` |

One instance holds one token, set at `initialize`. Amounts are `i128` in the
token's smallest unit: 1 XLM or 1 USDC is `10_000_000`. A job id is any 32
bytes; HeyPay uses `sha256(payment.id)`.

### Functions

| Function                                                   | Signed by        | Returns   | Errors                                         | Event                                  |
| ---------------------------------------------------------- | ---------------- | --------- | ---------------------------------------------- | -------------------------------------- |
| `initialize(admin: Address, token: Address)`               | `admin`          | `()`      | `AlreadyInitialized`                           | none                                   |
| `deposit(job_id: BytesN<32>, from: Address, amount: i128)` | `from`           | `()`      | `NotInitialized`, `JobExists`, `InvalidAmount` | `["escrow", "deposit", job_id]`        |
| `release(job_id: BytesN<32>)`                              | stored admin     | `()`      | `NotInitialized`, `JobNotFound`, `NotHeld`     | `["escrow", "release", job_id]`        |
| `refund(job_id: BytesN<32>)`                               | stored admin     | `()`      | `NotInitialized`, `JobNotFound`, `NotHeld`     | `["escrow", "refund", job_id]`         |
| `refund_after_timeout(job_id: BytesN<32>)`                 | the job's `from` | `()`      | `JobNotFound`, `NotHeld`, `DeadlineNotReached` | `["escrow", "refund_timeout", job_id]` |
| `set_timeout(ledgers: u32)`                                | stored admin     | `()`      | `NotInitialized`, `InvalidTimeout`             | none                                   |
| `get_job(job_id: BytesN<32>)`                              | nobody           | `Job`     | `JobNotFound`                                  | none                                   |
| `admin()`                                                  | nobody           | `Address` | `NotInitialized`                               | none                                   |
| `token()`                                                  | nobody           | `Address` | `NotInitialized`                               | none                                   |
| `timeout()`                                                | nobody           | `u32`     | none                                           | none                                   |

- `deposit` moves `amount` of the token from `from` into the contract and
  records `deadline_ledger = current ledger + timeout`.
- `release` pays the held amount to the admin. `refund` and
  `refund_after_timeout` pay it back to the job's `from`. No function takes a
  destination address.
- `refund_after_timeout` works from the deadline ledger onwards. The admin
  cannot call it.
- A job settles once. After `release`, `refund` or `refund_after_timeout`, the
  job stays stored with its final status and its id can never be deposited
  again.
- `set_timeout` only affects deposits made after it. The default window is
  17,280 ledgers (about 24 hours).

### Types

```ts
type Job = {
  amount: bigint; // i128, smallest unit of the token
  deadline_ledger: number; // u32
  from: string; // the payer's G... address
  status: { tag: "Held" } | { tag: "Released" } | { tag: "Refunded" };
};
```

### Errors

A refused call fails at simulation with `Error(Contract, #<code>)`, so nothing
is signed or sent.

| Code | Name                 | Meaning                                                 |
| ---- | -------------------- | ------------------------------------------------------- |
| 1    | `AlreadyInitialized` | `initialize` was already called                         |
| 2    | `NotInitialized`     | The instance has no admin or token yet                  |
| 3    | `JobExists`          | That job id was already deposited (held or settled)     |
| 4    | `JobNotFound`        | No job under that id                                    |
| 5    | `NotHeld`            | The job was already released or refunded                |
| 6    | `InvalidAmount`      | `deposit` with `amount <= 0`                            |
| 7    | `DeadlineNotReached` | `refund_after_timeout` before the job's deadline ledger |
| 8    | `InvalidTimeout`     | `set_timeout(0)`                                        |

### Events

Each event carries the job id as its third topic. The data is a map:

| Topics                                 | Data                                |
| -------------------------------------- | ----------------------------------- |
| `["escrow", "deposit", job_id]`        | `{ from, amount, deadline_ledger }` |
| `["escrow", "release", job_id]`        | `{ to, amount }`                    |
| `["escrow", "refund", job_id]`         | `{ to, amount }`                    |
| `["escrow", "refund_timeout", job_id]` | `{ to, amount }`                    |

Every call that moves funds also emits the token contract's own `transfer`
event. Real payloads are in
[`events.sample.json`](../../contracts/escrow/events.sample.json). To fetch the
events of any escrow transaction:

```sh
stellar tx fetch events --hash <tx hash> --network testnet --output json
```

## TypeScript client

`src/server/stellar/escrow-bindings` is the client
`stellar contract bindings typescript` generates from the contract's spec,
vendored as source (`pnpm contract:bindings` regenerates it from a local build).
To generate your own from the deployed contract:

```sh
stellar contract bindings typescript --network testnet \
  --contract-id CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J \
  --output-dir ./escrow-client
```

### `new Client(options)`

Extends `contract.Client` from `@stellar/stellar-sdk`. The options that matter:

| Option              | Required   | Meaning                                                                              |
| ------------------- | ---------- | ------------------------------------------------------------------------------------ |
| `contractId`        | yes        | The escrow instance                                                                  |
| `rpcUrl`            | yes        | Soroban RPC, e.g. `https://soroban-testnet.stellar.org`                              |
| `networkPassphrase` | yes        | `Networks.TESTNET`                                                                   |
| `publicKey`         | for writes | The transaction's source account                                                     |
| `signTransaction`   | for writes | Signs the envelope. `basicNodeSigner(keypair, passphrase)` gives one for a `Keypair` |
| `errorTypes`        | no         | The bindings' `Error` map. A refused call comes back as an `Err` result either way   |

### Methods

Every method builds the call and simulates it, and returns an
`AssembledTransaction`. Nothing is signed or sent until you call
`signAndSend()`.

| Method                                        | Result type                   |
| --------------------------------------------- | ----------------------------- |
| `initialize({ admin, token }, options?)`      | `Result<null>`                |
| `deposit({ job_id, from, amount }, options?)` | `Result<null>`                |
| `release({ job_id }, options?)`               | `Result<null>`                |
| `refund({ job_id }, options?)`                | `Result<null>`                |
| `refund_after_timeout({ job_id }, options?)`  | `Result<null>`                |
| `set_timeout({ ledgers }, options?)`          | `Result<null>`                |
| `get_job({ job_id }, options?)`               | `Result<Job>`                 |
| `admin(options?)`, `token(options?)`          | `Result<string>`              |
| `timeout(options?)`                           | `number`                      |
| `Client.deploy({ wasmHash, publicKey, ... })` | a client for the new instance |

`job_id` is a `Buffer` of 32 bytes, `amount` a `bigint` and addresses are `G...`
or `C...` strings. `options` takes `timeoutInSeconds` (how long the transaction
stays valid) and `fee`.

The pattern every write follows:

```ts
const tx = await client.release({ job_id: jobId }); // built and simulated
if (tx.result.isErr()) throw new Error("refused at simulation"); // nothing was sent
const sent = await tx.signAndSend({ force: true }); // signed, sent, waited for
const hash = sent.sendTransactionResponse?.hash;
```

Reads need no signer: `(await client.get_job({ job_id })).result.unwrap()`.
The contract's errors do not carry messages, so read the code from the
simulation error text (`Error(Contract, #5)`) and look it up in the bindings'
`Error` map, as `send()` in
[`snippets/shared.ts`](snippets/shared.ts) and `contractError()` in
`src/server/stellar/escrow.ts` do.

## HeyPay server wrapper

`src/server/stellar/escrow.ts` is how HeyPay's settle job calls the escrow. It
is server-only: it decrypts custodial keys. It is shown here so you can see how
each call is made and what it does when one fails.

### `EscrowService`

Made by `createEscrowService(options?)` or, per asset, `escrowFor(asset)`.
Amounts are `Decimal` in token units (not stroops).

| Method                                           | Signed by                            | Returns                                         |
| ------------------------------------------------ | ------------------------------------ | ----------------------------------------------- |
| `deposit({ jobId, encryptedSecret, amount })`    | the payer's custodial wallet         | `{ txHash }`                                    |
| `release(jobId)`                                 | admin (`HEYPAY_TREASURY_SECRET_ENC`) | `{ txHash }`                                    |
| `refund(jobId)`                                  | admin                                | `{ txHash }`                                    |
| `refundAfterTimeout({ jobId, encryptedSecret })` | the payer's custodial wallet         | `{ txHash }`                                    |
| `setTimeout(ledgers)`                            | admin                                | `{ txHash }`                                    |
| `getJob(jobId)`                                  | nobody                               | `EscrowJob \| null` (null when never deposited) |
| `getToken()`                                     | nobody                               | the SAC address it holds                        |
| `getTimeout()`                                   | nobody                               | ledgers                                         |
| `getLatestLedger()`                              | nobody                               | the network's latest ledger                     |
| `getFeeCharged(txHash)`                          | nobody                               | XLM fee actually charged, or null               |

`createEscrowService` options: `server` (an `rpc.Server`), `contractId` (a
string or a function read on each call; default `ESCROW_CONTRACT_ID`),
`networkPassphrase`, and `adminEncryptedSecret` (default
`HEYPAY_TREASURY_SECRET_ENC`).

### Errors

| Error                 | When                                                  | Fields                       |
| --------------------- | ----------------------------------------------------- | ---------------------------- |
| `EscrowContractError` | The contract refused at simulation; nothing was sent  | `method`, `code` (the name)  |
| `EscrowTxFailedError` | The transaction was sent but did not succeed on-chain | `method`, `txHash`, `status` |

The settle job treats `JobExists` on a deposit and `NotHeld` on a release or
refund as "already done", so running it again is safe.

### Helpers

| Function                                 | Does                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `escrowJobId(paymentId)`                 | `sha256(paymentId)` as a 32-byte `Buffer`                                              |
| `toStroops(amount)`                      | `Decimal` to `bigint` stroops; refuses zero, negatives and more than 7 decimals        |
| `escrowFor(asset)`                       | The `EscrowService` for the instance that holds `asset` (XLM or USDC)                  |
| `escrowHoldsAsset(asset)`                | Whether that instance's `token()` is the asset's own SAC                               |
| `sendSignedTransaction(tx)`              | Sends a transaction someone else signed: `accepted`, `rejected` with a code, or `busy` |
| `awaitSentTransaction(txHash, giveUpAt)` | Polls until `SUCCESS`, `FAILED`, or `NOT_FOUND` after `giveUpAt`                       |

From `src/server/stellar/escrow-config.ts`:

| Function                      | Does                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `escrowAppliesTo(asset)`      | True when `ESCROW_ENABLED=true` and the asset has an instance (XLM, USDC)                       |
| `escrowContractEnvKey(asset)` | `ESCROW_CONTRACT_ID` or `ESCROW_CONTRACT_ID_USDC`                                               |
| `escrowContractId(asset)`     | The instance's contract ID, or null                                                             |
| `escrowFeeEstimateXlm()`      | XLM reserved for a deposit's Soroban fee at quote time (`ESCROW_FEE_ESTIMATE_XLM`, default 0.2) |
| `escrowTimeoutLedgers()`      | The window the app keeps the contract at (`ESCROW_TIMEOUT_LEDGERS`), or null                    |

### Environment

| Variable                     | Meaning                                                                    |
| ---------------------------- | -------------------------------------------------------------------------- |
| `ESCROW_ENABLED`             | `true` routes the crypto leg of XLM and USDC payments through the escrow   |
| `ESCROW_CONTRACT_ID`         | XLM instance                                                               |
| `ESCROW_CONTRACT_ID_USDC`    | USDC instance                                                              |
| `SOROBAN_RPC_URL`            | Soroban RPC the server and the payer's browser use                         |
| `HEYPAY_TREASURY_SECRET_ENC` | Envelope-encrypted admin key that signs `release`, `refund`, `set_timeout` |
| `ESCROW_TIMEOUT_LEDGERS`     | Self-refund window to keep the contract at; empty leaves it alone          |
| `ESCROW_FEE_ESTIMATE_XLM`    | Fee reserved at quote time for a deposit                                   |
| `NONCUSTODIAL_ENABLED`       | `true` turns on the own-wallet API below; otherwise its routes answer 404  |

## Own-wallet API

A payer who pays from their own wallet (Freighter) signs the escrow call
themselves. HeyPay holds no key to that account. The pattern is the same for a deposit and a refund:

1. **prepare**: the server says what the call must be.
2. **build**: the browser builds and simulates it with the payer's account as
   source.
3. **sign**: the wallet signs. Nothing is sent by the wallet.
4. **signed**: the server checks the transaction is exactly that call, then
   sends it.

### Browser builders

From `src/lib/client/`. They load `@stellar/stellar-sdk` on first use and
never sign or send.

| Function                                                   | Builds                                    |
| ---------------------------------------------------------- | ----------------------------------------- |
| `buildEscrowDeposit(instructions, { server? })`            | `deposit(jobId, from, amount)`            |
| `buildEscrowTimeoutRefund(instructions, { server? })`      | `refund_after_timeout(jobId)`             |
| `buildEscrowCall(instructions, method, args, { server? })` | any escrow call, for the two above        |
| `jobIdBytes(hex)`                                          | the job id as the contract's `BytesN<32>` |

Each returns `{ xdr, txHash }`: the unsigned, simulated envelope and its hash.
They throw `EscrowCallBuildError` with a `reason`:

| `reason`                | Meaning                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `account_not_found`     | The payer's account does not exist on this network                                 |
| `simulation_failed`     | The network would not run the call (`detail` says why, e.g. `Error(Contract, #7)`) |
| `needs_other_signature` | The call needs an authorisation besides the payer's own envelope signature         |

The transaction's `maxTime` is always `validUntil`: one that never expires is
never built.

### Signing

`signWithFreighter(xdr, { address, networkPassphrase, networkName })` in
`src/components/wallet/freighter.ts` asks Freighter (through
StellarWalletsKit). It returns `{ ok: true, signedXdr }` or
`{ ok: false, reason, message }`, where `reason` is `not_installed`,
`cancelled`, `failed`, `wrong_network` or `wrong_account`. It checks the wallet
is on the right network and account before asking, so the payer is not asked
to sign something that would be refused.

### HTTP endpoints

All four need a signed-in payer session, a same-origin request and
`NONCUSTODIAL_ENABLED=true` (otherwise `404`). Each is limited to 20 requests a
minute per payer. Errors use HeyPay's envelope:

```json
{ "error": { "code": "BAD_REQUEST", "message": "...", "details": { "reason": "not_signed" } } }
```

#### `POST /api/payments/:id/prepare`

No body. For a `QUOTED` payment whose payer chose their own wallet, returns
what the deposit must be:

```json
{
  "paymentId": "cmg…",
  "contractId": "CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J",
  "jobId": "5f0c…(64 hex)",
  "from": "GDY2…UBH6",
  "amount": "100000000",
  "networkPassphrase": "Test SDF Network ; September 2015",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "validUntil": "2026-10-19T03:12:00.000Z"
}
```

`amount` is stroops as a string. `validUntil` is at most 120 seconds away and
never after the quote expires.

| Status | When                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 403    | Not this payer's payment                                                                                                                                                 |
| 404    | No such payment, or the feature is off                                                                                                                                   |
| 409    | Paid from the HeyPay wallet (`details.reason: "heypay_wallet_pays"`), not `QUOTED`, quote expired, the asset has no escrow, or the payer's account cannot hold the asset |

#### `POST /api/payments/:id/signed`

Body `{ "xdr": "<signed envelope, base64>" }`. The server refuses anything that
is not exactly `deposit(jobId, from, amount)` on the payment's escrow, from
`from`, signed by `from`'s key, valid no later than allowed. It records the
deposit on the payment, then sends it.

Returns `{ "paymentId", "status": "AUTHORIZED", "stellarTxHash" }`. The settle
job then confirms the deposit from the contract, pays the merchant and calls
`release`. Sending the same signed deposit again returns where the payment
stands without sending it twice.

| Status | `details.reason`    | Meaning                                                                          |
| ------ | ------------------- | -------------------------------------------------------------------------------- |
| 400    | `not_a_transaction` | Not a readable transaction (or a fee bump)                                       |
| 400    | `not_the_deposit`   | Some part differs from the prepared deposit                                      |
| 400    | `expired`           | Its validity ran out                                                             |
| 400    | `not_signed`        | Not signed by the connected account's key                                        |
| 409    | `network_rejected`  | The network would not run it (`details.code` has the result code); nothing moved |
| 409    | none                | Already confirmed, not `QUOTED`, or the quote expired                            |

#### `POST /api/payments/:id/escrow-refund/prepare`

No body. For a payment deposited from the payer's own wallet that is still held
past its deadline, returns `{ paymentId, contractId, jobId, from,
networkPassphrase, rpcUrl, validUntil }` for `refund_after_timeout`.

| Status | When                                                                                                                          |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 409    | Nothing held for this wallet, the escrow no longer holds it, or the deadline is still ahead (`details.secondsUntilAvailable`) |

#### `POST /api/payments/:id/escrow-refund/signed`

Body `{ "xdr": "<signed envelope, base64>" }`. Checked like a deposit. Before
sending it, the server stops the merchant payout, so a payment is never both
paid out and refunded; a payout already on its way to the bank cannot be
stopped, and the refund is refused with `409` and `details.waitingOnPayout:
true`. Returns `{ refundTxHash, status, failureReason, refundTxUrl }`; the
payment ends `REFUNDED`. Refusals use `details.reason` `not_a_transaction`,
`not_the_refund`, `expired`, `not_signed` or `network_rejected`.

The payer does not need HeyPay for this refund: `refund_after_timeout` needs
only their own signature, so they can make the call from any client once the
deadline has passed. The settle job then finds the job `Refunded` and closes
the payment.
