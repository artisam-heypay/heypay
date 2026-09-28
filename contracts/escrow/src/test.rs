#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;

struct Setup {
    env: Env,
    admin: Address,
    token: Address,
    escrow: EscrowClient<'static>,
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
