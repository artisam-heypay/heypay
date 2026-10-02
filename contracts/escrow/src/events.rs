use soroban_sdk::{contractevent, Address, BytesN};

/// Payer funds locked in the escrow under `job_id`.
#[contractevent(topics = ["escrow", "deposit"])]
pub struct Deposit {
    #[topic]
    pub job_id: BytesN<32>,
    pub from: Address,
    pub amount: i128,
    pub deadline_ledger: u32,
}

/// Held funds sent to the operator (HeyPay treasury) after a successful payout.
#[contractevent(topics = ["escrow", "release"])]
pub struct Release {
    #[topic]
    pub job_id: BytesN<32>,
    pub to: Address,
    pub amount: i128,
}

/// Held funds returned to the payer by the operator after a failed payout.
#[contractevent(topics = ["escrow", "refund"])]
pub struct Refund {
    #[topic]
    pub job_id: BytesN<32>,
    pub to: Address,
    pub amount: i128,
}

/// Held funds reclaimed by the payer after the deadline ledger passed.
#[contractevent(topics = ["escrow", "refund_timeout"])]
pub struct RefundTimeout {
    #[topic]
    pub job_id: BytesN<32>,
    pub to: Address,
    pub amount: i128,
}
