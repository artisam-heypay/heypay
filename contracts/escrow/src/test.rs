#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::token::{StellarAssetClient, TokenClient};

struct Setup {
    env: Env,
    admin: Address,
    token: Address,
    escrow: EscrowClient<'static>,
}

impl Setup {
    fn balance(&self, who: &Address) -> i128 {
        TokenClient::new(&self.env, &self.token).balance(who)
    }

    /// Initialized escrow plus a payer funded with `funds`.
    fn with_payer(&self, funds: i128) -> Address {
        self.escrow.initialize(&self.admin, &self.token);
        let payer = Address::generate(&self.env);
        StellarAssetClient::new(&self.env, &self.token).mint(&payer, &funds);
        payer
    }
}

fn job_id(env: &Env, n: u8) -> BytesN<32> {
    BytesN::from_array(env, &[n; 32])
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    let id = env.register(Escrow, ());
    let escrow = EscrowClient::new(&env, &id);

    Setup {
        env,
        admin,
        token,
        escrow,
    }
}

#[test]
fn initialize_stores_admin_and_token() {
    let s = setup();
    s.escrow.initialize(&s.admin, &s.token);

    assert_eq!(s.escrow.admin(), s.admin);
    assert_eq!(s.escrow.token(), s.token);
    assert_eq!(s.escrow.timeout(), storage::DEFAULT_TIMEOUT_LEDGERS);
}

#[test]
fn second_initialize_is_rejected() {
    let s = setup();
    s.escrow.initialize(&s.admin, &s.token);

    let other = Address::generate(&s.env);
    assert_eq!(
        s.escrow.try_initialize(&other, &s.token),
        Err(Ok(Error::AlreadyInitialized))
    );
    assert_eq!(s.escrow.admin(), s.admin);
}

#[test]
fn reads_before_initialize_fail() {
    let s = setup();
    assert_eq!(s.escrow.try_admin(), Err(Ok(Error::NotInitialized)));
}

#[test]
fn admin_can_set_timeout() {
    let s = setup();
    s.escrow.initialize(&s.admin, &s.token);

    s.escrow.set_timeout(&10);
    assert_eq!(s.escrow.timeout(), 10);
    assert_eq!(s.escrow.try_set_timeout(&0), Err(Ok(Error::InvalidTimeout)));
}

#[test]
fn deposit_moves_funds_into_the_escrow() {
    let s = setup();
    let payer = s.with_payer(1_000);
    s.env.ledger().set_sequence_number(100);
    let id = job_id(&s.env, 1);

    s.escrow.deposit(&id, &payer, &400);

    assert_eq!(s.balance(&payer), 600);
    assert_eq!(s.balance(&s.escrow.address), 400);
    assert_eq!(
        s.escrow.get_job(&id),
        Job {
            from: payer,
            amount: 400,
            deadline_ledger: 100 + storage::DEFAULT_TIMEOUT_LEDGERS,
            status: JobStatus::Held,
        }
    );
}

#[test]
fn deposit_rejects_a_reused_job_id() {
    let s = setup();
    let payer = s.with_payer(1_000);
    let id = job_id(&s.env, 1);
    s.escrow.deposit(&id, &payer, &400);

    assert_eq!(
        s.escrow.try_deposit(&id, &payer, &100),
        Err(Ok(Error::JobExists))
    );
    assert_eq!(s.balance(&s.escrow.address), 400);
}

#[test]
fn deposit_rejects_non_positive_amounts() {
    let s = setup();
    let payer = s.with_payer(1_000);
    let id = job_id(&s.env, 1);

    assert_eq!(
        s.escrow.try_deposit(&id, &payer, &0),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        s.escrow.try_deposit(&id, &payer, &-5),
        Err(Ok(Error::InvalidAmount))
    );
}

#[test]
fn deposit_requires_the_payer_to_sign() {
    let s = setup();
    let payer = s.with_payer(1_000);
    s.env.set_auths(&[]);

    assert!(s
        .escrow
        .try_deposit(&job_id(&s.env, 1), &payer, &100)
        .is_err());
}

#[test]
fn deposit_uses_the_configured_timeout() {
    let s = setup();
    let payer = s.with_payer(1_000);
    s.escrow.set_timeout(&20);
    s.env.ledger().set_sequence_number(500);
    let id = job_id(&s.env, 2);

    s.escrow.deposit(&id, &payer, &1);

    assert_eq!(s.escrow.get_job(&id).deadline_ledger, 520);
}

#[test]
fn deposit_keeps_the_job_alive_past_its_deadline() {
    use soroban_sdk::testutils::storage::Persistent as _;

    let s = setup();
    let payer = s.with_payer(1_000);
    let id = job_id(&s.env, 3);
    s.escrow.deposit(&id, &payer, &1);

    let ttl = s.env.as_contract(&s.escrow.address, || {
        s.env
            .storage()
            .persistent()
            .get_ttl(&storage::DataKey::Job(id.clone()))
    });
    assert!(ttl > storage::DEFAULT_TIMEOUT_LEDGERS);
}

#[test]
fn release_pays_the_admin() {
    let s = setup();
    let payer = s.with_payer(1_000);
    let id = job_id(&s.env, 1);
    s.escrow.deposit(&id, &payer, &400);

    s.escrow.release(&id);

    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, s.admin);
    assert_eq!(s.balance(&s.admin), 400);
    assert_eq!(s.balance(&s.escrow.address), 0);
    assert_eq!(s.escrow.get_job(&id).status, JobStatus::Released);
}

#[test]
fn refund_returns_funds_to_the_payer() {
    let s = setup();
    let payer = s.with_payer(1_000);
    let id = job_id(&s.env, 1);
    s.escrow.deposit(&id, &payer, &400);

    s.escrow.refund(&id);

    let auths = s.env.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, s.admin);
    assert_eq!(s.balance(&payer), 1_000);
    assert_eq!(s.balance(&s.escrow.address), 0);
    assert_eq!(s.escrow.get_job(&id).status, JobStatus::Refunded);
}

#[test]
fn a_job_settles_only_once() {
    let s = setup();
    let payer = s.with_payer(1_000);
    let released = job_id(&s.env, 1);
    let refunded = job_id(&s.env, 2);
    s.escrow.deposit(&released, &payer, &100);
    s.escrow.deposit(&refunded, &payer, &100);
    s.escrow.release(&released);
    s.escrow.refund(&refunded);

    assert_eq!(s.escrow.try_release(&released), Err(Ok(Error::NotHeld)));
    assert_eq!(s.escrow.try_refund(&released), Err(Ok(Error::NotHeld)));
    assert_eq!(s.escrow.try_release(&refunded), Err(Ok(Error::NotHeld)));
    assert_eq!(s.escrow.try_refund(&refunded), Err(Ok(Error::NotHeld)));
    assert_eq!(s.balance(&s.admin), 100);
    assert_eq!(s.balance(&payer), 900);
}

#[test]
fn settling_an_unknown_job_fails() {
    let s = setup();
    s.with_payer(0);
    let id = job_id(&s.env, 9);

    assert_eq!(s.escrow.try_release(&id), Err(Ok(Error::JobNotFound)));
    assert_eq!(s.escrow.try_refund(&id), Err(Ok(Error::JobNotFound)));
}

#[test]
fn release_and_refund_require_the_admin() {
    let s = setup();
    let payer = s.with_payer(1_000);
    let id = job_id(&s.env, 1);
    s.escrow.deposit(&id, &payer, &100);
    s.env.set_auths(&[]);

    assert!(s.escrow.try_release(&id).is_err());
    assert!(s.escrow.try_refund(&id).is_err());
    assert_eq!(s.escrow.get_job(&id).status, JobStatus::Held);
}
