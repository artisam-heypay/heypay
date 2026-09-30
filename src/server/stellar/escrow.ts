import "server-only";
import { createHash } from "node:crypto";
import { Keypair, rpc } from "@stellar/stellar-sdk";
import {
  basicNodeSigner,
  type AssembledTransaction,
  type Result,
} from "@stellar/stellar-sdk/contract";
import { Decimal } from "@/lib/money";
import { decryptSecret } from "@/server/crypto/envelope";
import { Client, Error as ContractErrors, type Job } from "./escrow-bindings";
import { getNetworkPassphrase } from "./horizon";

/** The escrow contract's `Error` enum, by name. */
export type EscrowErrorCode =
  | "AlreadyInitialized"
  | "NotInitialized"
  | "JobExists"
  | "JobNotFound"
  | "NotHeld"
  | "InvalidAmount"
  | "DeadlineNotReached"
  | "InvalidTimeout";

/**
 * The contract rejected the call (found at simulation, before anything is
 * sent). `JobExists` on deposit and `NotHeld` on release/refund mean the job
 * was already handled, so a rerun of the settle job can treat them as done.
 */
export class EscrowContractError extends Error {
  constructor(
    readonly method: string,
    readonly code: EscrowErrorCode,
  ) {
    super(`Escrow ${method} rejected by the contract: ${code}`);
    this.name = "EscrowContractError";
  }
}

/** The transaction was sent but did not succeed on-chain. */
export class EscrowTxFailedError extends Error {
  constructor(
    readonly method: string,
    readonly txHash: string,
    readonly status: string,
  ) {
    super(`Escrow ${method} transaction ${txHash} ended with status ${status}`);
    this.name = "EscrowTxFailedError";
  }
}

export type EscrowJobStatus = "Held" | "Released" | "Refunded";

export type EscrowJob = {
  from: string;
  /** In the escrow token's units (XLM), not stroops. */
  amount: Decimal;
  deadlineLedger: number;
  status: EscrowJobStatus;
};

export interface EscrowService {
  /** Locks `amount` from the payer's custodial wallet under `jobId`. */
  deposit(input: {
    jobId: Buffer;
    encryptedSecret: string;
    amount: Decimal;
  }): Promise<{ txHash: string }>;
  /** Admin: pays a held job to the treasury after a successful payout. */
  release(jobId: Buffer): Promise<{ txHash: string }>;
  /** Admin: returns a held job to the payer after a failed payout. */
  refund(jobId: Buffer): Promise<{ txHash: string }>;
  /** The job as stored on-chain, or null if it was never deposited. */
  getJob(jobId: Buffer): Promise<EscrowJob | null>;
  /**
   * The XLM fee a successful escrow transaction actually charged its source
   * (Soroban resource fee included, after the refund of unused resources), or
   * null when the RPC no longer has the transaction or it did not succeed.
   */
  getFeeCharged(txHash: string): Promise<Decimal | null>;
}

// Matches the wallet's transaction lifetime; also bounds how long we poll
// getTransaction after sending.
const TX_TIMEOUT_SECONDS = 180;
const STROOPS_PER_UNIT = new Decimal(10_000_000);

/** A payment's escrow job id: `sha256(payment.id)`, the contract's `BytesN<32>`. */
export function escrowJobId(paymentId: string): Buffer {
  return createHash("sha256").update(paymentId).digest();
}

/** Converts a token amount to stroops, refusing anything below 1 stroop. */
export function toStroops(amount: Decimal): bigint {
  const stroops = amount.times(STROOPS_PER_UNIT);
  if (!stroops.isInteger() || stroops.lte(0)) {
    throw new Error(`Escrow amount must be positive with at most 7 decimals, got ${amount}`);
  }
  return BigInt(stroops.toFixed(0));
}

function fromStroops(stroops: bigint): Decimal {
  return new Decimal(stroops.toString()).div(STROOPS_PER_UNIT);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

let defaultServer: rpc.Server | null = null;

function getSorobanRpc(): rpc.Server {
  if (!defaultServer) {
    const url = requireEnv("SOROBAN_RPC_URL");
    defaultServer = new rpc.Server(url, { allowHttp: url.startsWith("http://") });
  }
  return defaultServer;
}

export function __resetSorobanRpcForTests(): void {
  defaultServer = null;
}

const CONTRACT_ERROR_PATTERN = /Error\(Contract, #(\d+)\)/;
const CONTRACT_ERROR_NAMES: Record<number, { message: string }> = ContractErrors;

/**
 * Turns a simulated `Result::Err` into a typed error. The SDK fills error
 * messages from the enum's doc comments, which the contract does not have, so
 * the name comes from the numeric code in the simulation error instead.
 */
function contractError(method: string, tx: AssembledTransaction<unknown>): Error {
  const sim = tx.simulation;
  const raw = sim && "error" in sim ? sim.error : "";
  const code = CONTRACT_ERROR_NAMES[Number(CONTRACT_ERROR_PATTERN.exec(raw)?.[1])]?.message;
  return code
    ? new EscrowContractError(method, code as EscrowErrorCode)
    : new Error(`Escrow ${method} failed: ${raw || "unknown contract error"}`);
}

export function createEscrowService(
  options: {
    server?: rpc.Server;
    contractId?: string;
    networkPassphrase?: string;
    /** Envelope-encrypted admin secret. Default: HEYPAY_TREASURY_SECRET_ENC. */
    adminEncryptedSecret?: string;
  } = {},
): EscrowService {
  const server = () => options.server ?? getSorobanRpc();
  const net = () => options.networkPassphrase ?? getNetworkPassphrase();
  const contractId = () => options.contractId ?? requireEnv("ESCROW_CONTRACT_ID");
  const adminSecret = () =>
    options.adminEncryptedSecret ?? requireEnv("HEYPAY_TREASURY_SECRET_ENC");

  /** A contract client whose calls are sourced and signed by `keypair`. */
  function clientFor(keypair: Keypair | null): Client {
    const srv = server();
    return new Client({
      contractId: contractId(),
      networkPassphrase: net(),
      rpcUrl: srv.serverURL.toString(),
      server: srv,
      errorTypes: ContractErrors,
      ...(keypair && {
        publicKey: keypair.publicKey(),
        ...basicNodeSigner(keypair, net()),
      }),
    });
  }

  /**
   * Simulate (done by the client on build) → reject contract errors → prepare
   * and sign → send → poll getTransaction until it lands.
   */
  async function submit(
    method: string,
    encryptedSecret: string,
    build: (client: Client) => Promise<AssembledTransaction<Result<unknown>>>,
  ): Promise<{ txHash: string }> {
    // Decrypt only here, in-memory; the secret never leaves this scope.
    const keypair = Keypair.fromSecret(decryptSecret(encryptedSecret));
    const tx = await build(clientFor(keypair));
    if (tx.result.isErr()) {
      throw contractError(method, tx);
    }
    // force: every escrow write is a state change; never let the client skip
    // sending because it misjudged the call as read-only.
    const sent = await tx.signAndSend({ force: true });
    const txHash = sent.sendTransactionResponse?.hash ?? "";
    const status = sent.getTransactionResponse?.status ?? "UNKNOWN";
    if (status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new EscrowTxFailedError(method, txHash, status);
    }
    return { txHash };
  }

  const txOptions = { timeoutInSeconds: TX_TIMEOUT_SECONDS };

  return {
    deposit({ jobId, encryptedSecret, amount }) {
      const stroops = toStroops(amount);
      return submit("deposit", encryptedSecret, (client) =>
        client.deposit(
          { job_id: jobId, from: client.options.publicKey!, amount: stroops },
          txOptions,
        ),
      );
    },

    release(jobId) {
      return submit("release", adminSecret(), (client) =>
        client.release({ job_id: jobId }, txOptions),
      );
    },

    refund(jobId) {
      return submit("refund", adminSecret(), (client) =>
        client.refund({ job_id: jobId }, txOptions),
      );
    },

    async getJob(jobId) {
      const tx = await clientFor(null).get_job({ job_id: jobId });
      if (tx.result.isErr()) {
        const err = contractError("get_job", tx);
        if (err instanceof EscrowContractError && err.code === "JobNotFound") return null;
        throw err;
      }
      const job: Job = tx.result.unwrap();
      return {
        from: job.from,
        amount: fromStroops(job.amount),
        deadlineLedger: job.deadline_ledger,
        status: job.status.tag,
      };
    },

    async getFeeCharged(txHash) {
      const res = await server().getTransaction(txHash);
      if (res.status !== rpc.Api.GetTransactionStatus.SUCCESS) return null;
      return fromStroops(BigInt(res.resultXdr.feeCharged().toString()));
    },
  };
}

export const escrowService: EscrowService = createEscrowService();
