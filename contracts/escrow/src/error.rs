use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
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
