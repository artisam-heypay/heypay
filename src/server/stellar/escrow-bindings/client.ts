import {Job} from './types';
import {Result, Spec, AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions} from '@stellar/stellar-sdk/contract';
import {Address} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

export interface Client {
  admin(options?: MethodOptions): Promise<AssembledTransaction<Result<string, Error>>>;
  token(options?: MethodOptions): Promise<AssembledTransaction<Result<string, Error>>>;
  /**
   * Admin-only: returns a held job's funds to the payer after a failed
   * payout.
   */
  refund({ job_id }: { job_id: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * Locks `amount` of the escrow token from `from` under `job_id`. The payer
   * can self-refund once the ledger reaches the job's deadline.
   */
  deposit({ job_id, from, amount }: { job_id: Buffer; from: string | Address; amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  get_job({ job_id }: { job_id: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<Result<Job, Error>>>;
  /**
   * Admin-only: sends a held job's funds to the admin (HeyPay treasury)
   * once the payout has succeeded.
   */
  release({ job_id }: { job_id: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  timeout(options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * One-time setup: the operator `admin` and the Stellar Asset Contract
   * `token` the escrow holds.
   */
  initialize({ admin, token }: { admin: string | Address; token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * Admin-only: change the payer self-refund window, in ledgers.
   */
  set_timeout({ ledgers }: { ledgers: number }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * Payer-only: reclaims a held job once the ledger reaches its deadline,
   * so funds never depend on HeyPay acting.
   */
  refund_after_timeout({ job_id }: { job_id: Buffer }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
}

export class Client extends ContractClient {
  constructor(public override readonly options: ContractClientOptions) {
    super(
      new Spec(["AAAAAAAAAAAAAAAFYWRtaW4AAAAAAAAAAAAAAQAAA+kAAAATAAAAAw==", "AAAAAAAAAAAAAAAFdG9rZW4AAAAAAAAAAAAAAQAAA+kAAAATAAAAAw==", "AAAAAAAAAEpBZG1pbi1vbmx5OiByZXR1cm5zIGEgaGVsZCBqb2IncyBmdW5kcyB0byB0aGUgcGF5ZXIgYWZ0ZXIgYSBmYWlsZWQKcGF5b3V0LgAAAAAABnJlZnVuZAAAAAAAAQAAAAAAAAAGam9iX2lkAAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=", "AAAAAAAAAIRMb2NrcyBgYW1vdW50YCBvZiB0aGUgZXNjcm93IHRva2VuIGZyb20gYGZyb21gIHVuZGVyIGBqb2JfaWRgLiBUaGUgcGF5ZXIKY2FuIHNlbGYtcmVmdW5kIG9uY2UgdGhlIGxlZGdlciByZWFjaGVzIHRoZSBqb2IncyBkZWFkbGluZS4AAAAHZGVwb3NpdAAAAAADAAAAAAAAAAZqb2JfaWQAAAAAA+4AAAAgAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAQAAA+kAAAACAAAAAw==", "AAAAAAAAAAAAAAAHZ2V0X2pvYgAAAAABAAAAAAAAAAZqb2JfaWQAAAAAA+4AAAAgAAAAAQAAA+kAAAfQAAAAA0pvYgAAAAAD", "AAAAAAAAAGJBZG1pbi1vbmx5OiBzZW5kcyBhIGhlbGQgam9iJ3MgZnVuZHMgdG8gdGhlIGFkbWluIChIZXlQYXkgdHJlYXN1cnkpCm9uY2UgdGhlIHBheW91dCBoYXMgc3VjY2VlZGVkLgAAAAAAB3JlbGVhc2UAAAAAAQAAAAAAAAAGam9iX2lkAAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=", "AAAAAAAAAAAAAAAHdGltZW91dAAAAAAAAAAAAQAAAAQ=", "AAAAAAAAAF1PbmUtdGltZSBzZXR1cDogdGhlIG9wZXJhdG9yIGBhZG1pbmAgYW5kIHRoZSBTdGVsbGFyIEFzc2V0IENvbnRyYWN0CmB0b2tlbmAgdGhlIGVzY3JvdyBob2xkcy4AAAAAAAAKaW5pdGlhbGl6ZQAAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD6QAAAAIAAAAD", "AAAAAAAAADxBZG1pbi1vbmx5OiBjaGFuZ2UgdGhlIHBheWVyIHNlbGYtcmVmdW5kIHdpbmRvdywgaW4gbGVkZ2Vycy4AAAALc2V0X3RpbWVvdXQAAAAAAQAAAAAAAAAHbGVkZ2VycwAAAAAEAAAAAQAAA+kAAAACAAAAAw==", "AAAAAAAAAG1QYXllci1vbmx5OiByZWNsYWltcyBhIGhlbGQgam9iIG9uY2UgdGhlIGxlZGdlciByZWFjaGVzIGl0cyBkZWFkbGluZSwKc28gZnVuZHMgbmV2ZXIgZGVwZW5kIG9uIEhleVBheSBhY3RpbmcuAAAAAAAAFHJlZnVuZF9hZnRlcl90aW1lb3V0AAAAAQAAAAAAAAAGam9iX2lkAAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=", "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACAAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAJSm9iRXhpc3RzAAAAAAAAAwAAAAAAAAALSm9iTm90Rm91bmQAAAAABAAAAAAAAAAHTm90SGVsZAAAAAAFAAAAAAAAAA1JbnZhbGlkQW1vdW50AAAAAAAABgAAAAAAAAASRGVhZGxpbmVOb3RSZWFjaGVkAAAAAAAHAAAAAAAAAA5JbnZhbGlkVGltZW91dAAAAAAACA==", "AAAABQAAAEdIZWxkIGZ1bmRzIHJldHVybmVkIHRvIHRoZSBwYXllciBieSB0aGUgb3BlcmF0b3IgYWZ0ZXIgYSBmYWlsZWQgcGF5b3V0LgAAAAAAAAAABlJlZnVuZAAAAAAAAgAAAAZlc2Nyb3cAAAAAAAZyZWZ1bmQAAAAAAAMAAAAAAAAABmpvYl9pZAAAAAAD7gAAACAAAAABAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAC", "AAAABQAAADBQYXllciBmdW5kcyBsb2NrZWQgaW4gdGhlIGVzY3JvdyB1bmRlciBgam9iX2lkYC4AAAAAAAAAB0RlcG9zaXQAAAAAAgAAAAZlc2Nyb3cAAAAAAAdkZXBvc2l0AAAAAAQAAAAAAAAABmpvYl9pZAAAAAAD7gAAACAAAAABAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAAAAAAD2RlYWRsaW5lX2xlZGdlcgAAAAAEAAAAAAAAAAI=", "AAAABQAAAExIZWxkIGZ1bmRzIHNlbnQgdG8gdGhlIG9wZXJhdG9yIChIZXlQYXkgdHJlYXN1cnkpIGFmdGVyIGEgc3VjY2Vzc2Z1bCBwYXlvdXQuAAAAAAAAAAdSZWxlYXNlAAAAAAIAAAAGZXNjcm93AAAAAAAHcmVsZWFzZQAAAAADAAAAAAAAAAZqb2JfaWQAAAAAA+4AAAAgAAAAAQAAAAAAAAACdG8AAAAAABMAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAg==", "AAAABQAAAENIZWxkIGZ1bmRzIHJlY2xhaW1lZCBieSB0aGUgcGF5ZXIgYWZ0ZXIgdGhlIGRlYWRsaW5lIGxlZGdlciBwYXNzZWQuAAAAAAAAAAANUmVmdW5kVGltZW91dAAAAAAAAAIAAAAGZXNjcm93AAAAAAAOcmVmdW5kX3RpbWVvdXQAAAAAAAMAAAAAAAAABmpvYl9pZAAAAAAD7gAAACAAAAABAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAC", "AAAAAQAAAAAAAAAAAAAAA0pvYgAAAAAEAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAD2RlYWRsaW5lX2xlZGdlcgAAAAAEAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGc3RhdHVzAAAAAAfQAAAACUpvYlN0YXR1cwAAAA==", "AAAAAgAAAAAAAAAAAAAACUpvYlN0YXR1cwAAAAAAAAMAAAAAAAAAAAAAAARIZWxkAAAAAAAAAAAAAAAIUmVsZWFzZWQAAAAAAAAAAAAAAAhSZWZ1bmRlZA=="]),
      options
    );
  }

   static override deploy<T = Client>(options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { wasmHash: Buffer | string; salt?: Buffer | Uint8Array; format?: "hex" | "base64"; address?: string; }): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options);
  }
  public readonly fromJSON = {
    admin : this.txFromJSON<Result<string, Error>>,  token : this.txFromJSON<Result<string, Error>>,  refund : this.txFromJSON<Result<null, Error>>,  deposit : this.txFromJSON<Result<null, Error>>,  get_job : this.txFromJSON<Result<Job, Error>>,  release : this.txFromJSON<Result<null, Error>>,  timeout : this.txFromJSON<number>,  initialize : this.txFromJSON<Result<null, Error>>,  set_timeout : this.txFromJSON<Result<null, Error>>,  refund_after_timeout : this.txFromJSON<Result<null, Error>>
  };
}