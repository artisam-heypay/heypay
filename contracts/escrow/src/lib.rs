#![no_std]
//! HeyPay settlement escrow: holds a payer's funds per job until the operator
//! releases them to the treasury or refunds them to the payer.

use soroban_sdk::{contract, contractimpl, Env};

#[contract]
pub struct Escrow;

#[contractimpl]
impl Escrow {
    pub fn version(_env: Env) -> u32 {
        1
    }
}

#[cfg(test)]
mod test;
