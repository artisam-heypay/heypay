#![cfg(test)]

use super::*;

#[test]
fn reports_version() {
    let env = Env::default();
    let id = env.register(Escrow, ());
    let client = EscrowClient::new(&env, &id);
    assert_eq!(client.version(), 1);
}
