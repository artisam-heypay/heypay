use soroban_sdk::{contracttype, Address, BytesN, Env};

use crate::error::Error;

/// Ledgers per day at ~5s per ledger.
pub const DAY_IN_LEDGERS: u32 = 17_280;
/// Default payer self-refund window (~24h).
pub const DEFAULT_TIMEOUT_LEDGERS: u32 = DAY_IN_LEDGERS;

const INSTANCE_BUMP_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;
const INSTANCE_BUMP_AMOUNT: u32 = 30 * DAY_IN_LEDGERS;
/// Extra life kept on a job entry after its deadline so the payer has time to
/// call `refund_after_timeout` before the entry is archived.
const JOB_TTL_BUFFER: u32 = 30 * DAY_IN_LEDGERS;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Token,
    Timeout,
    Job(BytesN<32>),
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JobStatus {
    Held,
    Released,
    Refunded,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Job {
    pub from: Address,
    pub amount: i128,
    pub deadline_ledger: u32,
    pub status: JobStatus,
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_token(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .ok_or(Error::NotInitialized)
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::Token, token);
}

pub fn get_timeout(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::Timeout)
        .unwrap_or(DEFAULT_TIMEOUT_LEDGERS)
}

pub fn set_timeout(env: &Env, ledgers: u32) {
    env.storage().instance().set(&DataKey::Timeout, &ledgers);
}

pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_BUMP_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

pub fn has_job(env: &Env, job_id: &BytesN<32>) -> bool {
    env.storage().persistent().has(&DataKey::Job(job_id.clone()))
}

pub fn get_job(env: &Env, job_id: &BytesN<32>) -> Result<Job, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Job(job_id.clone()))
        .ok_or(Error::JobNotFound)
}

/// Stores the job and keeps it alive until well past its deadline ledger.
pub fn set_job(env: &Env, job_id: &BytesN<32>, job: &Job) {
    let key = DataKey::Job(job_id.clone());
    let max_ttl = env.storage().max_ttl();
    let storage = env.storage().persistent();
    storage.set(&key, job);

    let current = env.ledger().sequence();
    let wanted = job
        .deadline_ledger
        .saturating_sub(current)
        .saturating_add(JOB_TTL_BUFFER);
    let extend_to = wanted.min(max_ttl);
    storage.extend_ttl(&key, extend_to, extend_to);
}
