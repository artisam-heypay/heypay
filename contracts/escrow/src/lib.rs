#![no_std]
//! HeyPay settlement escrow: holds a payer's funds per job until the operator
//! releases them to the treasury or refunds them to the payer.

use soroban_sdk::{contract, contractimpl, Address, Env};

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
