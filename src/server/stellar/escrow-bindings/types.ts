import {Address} from '@stellar/stellar-sdk';

    /**
 * Error Enum: Error
 */
export const Error = {
  1 : { message: "AlreadyInitialized" },
  2 : { message: "NotInitialized" },
  3 : { message: "JobExists" },
  4 : { message: "JobNotFound" },
  5 : { message: "NotHeld" },
  6 : { message: "InvalidAmount" },
  7 : { message: "DeadlineNotReached" },
  8 : { message: "InvalidTimeout" }
}

/**
 * Struct: Job
 */
export interface Job {
  amount: bigint;
  deadline_ledger: number;
  from: string;
  status: JobStatus;
}

/**
 * Union: JobStatus
 */
 export type JobStatus =
  { tag: "Held"; values: void } |
  { tag: "Released"; values: void } |
  { tag: "Refunded"; values: void };
    