# escrow — contract interface

The spec of the deployed Testnet contract
[`CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J`](https://stellar.expert/explorer/testnet/contract/CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J)
(WASM hash `f3ccfe37fa39403a82bc835f18f0b68c83d1503a5d058ec02ae5878143872f60`),
exported with:

```sh
stellar contract info interface \
  --contract-id CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J \
  --network testnet --output rust
```

Use `--wasm target/wasm32v1-none/release/escrow.wasm` instead of `--contract-id`
for a local build, or `--output json` for the raw `SCSpecEntry` values. The
TypeScript client generated from the same spec is in
`src/server/stellar/escrow-bindings` (`pnpm contract:bindings`).

What each function does, who may call it and when each error is returned is in
[README.md](README.md). Sample event payloads are in
[events.sample.json](events.sample.json).

```rust
#[soroban_sdk::contractargs(name = "Args")]
#[soroban_sdk::contractclient(name = "Client")]
pub trait Contract {
    fn admin(env: soroban_sdk::Env) -> Result<soroban_sdk::Address, Error>;
    fn token(env: soroban_sdk::Env) -> Result<soroban_sdk::Address, Error>;
    fn refund(
        env: soroban_sdk::Env,
        job_id: soroban_sdk::BytesN<32>,
    ) -> Result<(), Error>;
    fn deposit(
        env: soroban_sdk::Env,
        job_id: soroban_sdk::BytesN<32>,
        from: soroban_sdk::Address,
        amount: i128,
    ) -> Result<(), Error>;
    fn get_job(
        env: soroban_sdk::Env,
        job_id: soroban_sdk::BytesN<32>,
    ) -> Result<Job, Error>;
    fn release(
        env: soroban_sdk::Env,
        job_id: soroban_sdk::BytesN<32>,
    ) -> Result<(), Error>;
    fn timeout(env: soroban_sdk::Env) -> u32;
    fn initialize(
        env: soroban_sdk::Env,
        admin: soroban_sdk::Address,
        token: soroban_sdk::Address,
    ) -> Result<(), Error>;
    fn set_timeout(env: soroban_sdk::Env, ledgers: u32) -> Result<(), Error>;
    fn refund_after_timeout(
        env: soroban_sdk::Env,
        job_id: soroban_sdk::BytesN<32>,
    ) -> Result<(), Error>;
}
#[soroban_sdk::contracttype]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Job {
    pub amount: i128,
    pub deadline_ledger: u32,
    pub from: soroban_sdk::Address,
    pub status: JobStatus,
}
#[soroban_sdk::contracttype]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum JobStatus {
    Held,
    Released,
    Refunded,
}
#[soroban_sdk::contracterror]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    JobExists = 3,
    JobNotFound = 4,
    NotHeld = 5,
    InvalidAmount = 6,
    DeadlineNotReached = 7,
    InvalidTimeout = 8,
}
#[soroban_sdk::contractevent(topics = ["escrow", "refund"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Refund {
    #[topic]
    pub job_id: soroban_sdk::BytesN<32>,
    pub to: soroban_sdk::Address,
    pub amount: i128,
}
#[soroban_sdk::contractevent(topics = ["escrow", "deposit"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Deposit {
    #[topic]
    pub job_id: soroban_sdk::BytesN<32>,
    pub from: soroban_sdk::Address,
    pub amount: i128,
    pub deadline_ledger: u32,
}
#[soroban_sdk::contractevent(topics = ["escrow", "release"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Release {
    #[topic]
    pub job_id: soroban_sdk::BytesN<32>,
    pub to: soroban_sdk::Address,
    pub amount: i128,
}
#[soroban_sdk::contractevent(topics = ["escrow", "refund_timeout"])]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct RefundTimeout {
    #[topic]
    pub job_id: soroban_sdk::BytesN<32>,
    pub to: soroban_sdk::Address,
    pub amount: i128,
}
```
