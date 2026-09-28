#![no_std]
//! HeyPay settlement escrow: holds a payer's funds per job until the operator
//! releases them to the treasury or refunds them to the payer.

use soroban_sdk::{contract, contractimpl, token, Address, BytesN, Env};

pub mod error;
pub mod events;
pub mod storage;

pub use error::Error;
pub use storage::{Job, JobStatus};

#[contract]
pub struct Escrow;

#[contractimpl]
impl Escrow {
    /// One-time setup: the operator `admin` and the Stellar Asset Contract
    /// `token` the escrow holds.
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), Error> {
        if storage::is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        storage::set_admin(&env, &admin);
        storage::set_token(&env, &token);
        storage::bump_instance(&env);
        Ok(())
    }

    /// Admin-only: change the payer self-refund window, in ledgers.
    pub fn set_timeout(env: Env, ledgers: u32) -> Result<(), Error> {
        storage::get_admin(&env)?.require_auth();
        if ledgers == 0 {
            return Err(Error::InvalidTimeout);
        }
        storage::set_timeout(&env, ledgers);
        storage::bump_instance(&env);
        Ok(())
    }

    /// Locks `amount` of the escrow token from `from` under `job_id`. The payer
    /// can self-refund once the ledger reaches the job's deadline.
    pub fn deposit(env: Env, job_id: BytesN<32>, from: Address, amount: i128) -> Result<(), Error> {
        from.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if storage::has_job(&env, &job_id) {
            return Err(Error::JobExists);
        }
        let token = storage::get_token(&env)?;
        let deadline_ledger = env
            .ledger()
            .sequence()
            .saturating_add(storage::get_timeout(&env));

        let job = Job {
            from: from.clone(),
            amount,
            deadline_ledger,
            status: JobStatus::Held,
        };
        storage::set_job(&env, &job_id, &job);
        storage::bump_instance(&env);

        token::Client::new(&env, &token).transfer(&from, &env.current_contract_address(), &amount);

        events::Deposit {
            job_id,
            from,
            amount,
            deadline_ledger,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_job(env: Env, job_id: BytesN<32>) -> Result<Job, Error> {
        storage::get_job(&env, &job_id)
    }

    pub fn admin(env: Env) -> Result<Address, Error> {
        storage::get_admin(&env)
    }

    pub fn token(env: Env) -> Result<Address, Error> {
        storage::get_token(&env)
    }

    pub fn timeout(env: Env) -> u32 {
        storage::get_timeout(&env)
    }
}

#[cfg(test)]
mod test;
