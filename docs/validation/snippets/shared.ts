// docs/validation/snippets/shared.ts
//
// What every snippet needs: the Testnet endpoints, throwaway accounts funded by
// Friendbot, a typed client for an escrow instance, and one way to send a
// contract call and wait for it. Nothing here is HeyPay-specific except the
// published escrow WASM hash.
//
// The typed `Client` is the one `stellar contract bindings typescript`
// generates from the escrow's spec. HeyPay keeps its copy in
// src/server/stellar/escrow-bindings; generate your own with
//   stellar contract bindings typescript --network testnet \
//     --contract-id CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J \
//     --output-dir ./escrow-client
import { createHash } from "node:crypto";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  TransactionBuilder,
  rpc,
  type xdr,
} from "@stellar/stellar-sdk";
import { basicNodeSigner, type AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { Client, Error as EscrowErrors } from "../../../src/server/stellar/escrow-bindings";

export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const RPC_URL = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
export const HORIZON_URL = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";

/**
 * The escrow WASM HeyPay runs, already installed on Testnet: the `escrow.wasm`
 * of release escrow-v1.0-testnet. A new instance is created from this hash, so nothing
 * has to be built or uploaded.
 */
export const ESCROW_WASM_HASH = "f3ccfe37fa39403a82bc835f18f0b68c83d1503a5d058ec02ae5878143872f60";

/** Circle's Testnet USDC, the asset HeyPay's USDC escrow holds. */
export const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");

/** The Stellar Asset Contract (SEP-41 token) of an asset on Testnet. */
export const tokenOf = (asset: Asset): string => asset.contractId(NETWORK_PASSPHRASE);

export const sorobanRpc = new rpc.Server(RPC_URL);
export const horizon = new Horizon.Server(HORIZON_URL);

export const txUrl = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
export const contractUrl = (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`;

/** 1 XLM or 1 USDC is 10,000,000 stroops; the contract counts in stroops. */
export const toStroops = (units: number): bigint => BigInt(Math.round(units * 10_000_000));

/** A job id is any 32 bytes; HeyPay uses sha256 of its payment id. */
export const jobIdFor = (orderId: string): Buffer => createHash("sha256").update(orderId).digest();

/** A new Testnet account holding 10,000 XLM from Friendbot. */
export async function fundedAccount(): Promise<Keypair> {
  const keypair = Keypair.random();
  const res = await fetch(`https://friendbot.stellar.org?addr=${keypair.publicKey()}`);
  if (!res.ok) throw new Error(`Friendbot did not fund ${keypair.publicKey()}: ${res.status}`);
  return keypair;
}

/** The escrow at `contractId`. Calls are sourced and signed by `signer`; reads need none. */
export function escrowClient(contractId: string, signer?: Keypair): Client {
  return new Client({
    contractId,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    ...(signer && {
      publicKey: signer.publicKey(),
      ...basicNodeSigner(signer, NETWORK_PASSPHRASE),
    }),
  });
}

/** The contract turned the call down at simulation, so nothing was sent. */
export class EscrowRejected extends Error {
  constructor(
    readonly method: string,
    readonly code: string,
  ) {
    super(`${method} rejected by the escrow: ${code}`);
    this.name = "EscrowRejected";
  }
}

/**
 * The contract error a simulation returned, by name (`NotHeld`,
 * `DeadlineNotReached`, ...). It arrives as `Error(Contract, #5)` in the
 * simulation's error text; the names are the bindings' `Error` enum.
 */
function rejection(method: string, tx: AssembledTransaction<unknown>): EscrowRejected {
  const sim = tx.simulation;
  const raw = sim && "error" in sim ? sim.error : "";
  const code = Number(/Error\(Contract, #(\d+)\)/.exec(raw)?.[1]);
  const names: Record<number, { message: string }> = EscrowErrors;
  return new EscrowRejected(method, names[code]?.message ?? (raw || "unknown error"));
}

/**
 * Simulates, signs, sends and waits for a contract call. A call the contract
 * would refuse fails at simulation with `EscrowRejected`, before anything is
 * signed. Returns the transaction hash once it has succeeded on-chain.
 */
export async function send(
  method: string,
  tx: AssembledTransaction<{ isErr(): boolean } | unknown>,
): Promise<string> {
  const result = tx.result as { isErr?: () => boolean } | undefined;
  if (result?.isErr?.()) throw rejection(method, tx);
  // force: a write the client misjudges as read-only must still be sent.
  const sent = await tx.signAndSend({ force: true });
  const hash = sent.sendTransactionResponse?.hash ?? "";
  const status = sent.getTransactionResponse?.status;
  if (status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`${method} transaction ${hash} ended ${status ?? "without a result"}`);
  }
  return hash;
}

/**
 * Creates a new escrow instance from the published WASM and initializes it in
 * the next transaction. `admin` deploys it and must sign `initialize`, so no
 * one else can claim the instance in between. `token` is the Stellar Asset
 * Contract of the one asset the instance will hold.
 */
export async function deployEscrow(
  admin: Keypair,
  token: string,
): Promise<{ contractId: string; deployTx: string; initTx: string }> {
  const deploy = await Client.deploy({
    wasmHash: ESCROW_WASM_HASH,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: admin.publicKey(),
    ...basicNodeSigner(admin, NETWORK_PASSPHRASE),
  });
  const deployed = await deploy.signAndSend();
  const contractId = deployed.result.options.contractId;
  const deployTx = deployed.sendTransactionResponse?.hash ?? "";

  const initTx = await send(
    "initialize",
    await escrowClient(contractId, admin).initialize({ admin: admin.publicKey(), token }),
  );
  return { contractId, deployTx, initTx };
}

/** The job the escrow holds under `jobId`, or a rejection when there is none. */
export async function readJob(contractId: string, jobId: Buffer) {
  const tx = await escrowClient(contractId).get_job({ job_id: jobId });
  if (tx.result.isErr()) throw rejection("get_job", tx);
  const job = tx.result.unwrap();
  return { ...job, status: job.status.tag };
}

/** Sends a classic (non-contract) transaction through Horizon. Returns its hash. */
export async function sendClassic(
  source: Keypair,
  ...operations: xdr.Operation[]
): Promise<string> {
  const account = await horizon.loadAccount(source.publicKey());
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  }).setTimeout(60);
  for (const op of operations) builder.addOperation(op);
  const tx = builder.build();
  tx.sign(source);
  return (await horizon.submitTransaction(tx)).hash;
}

/** The account's balance of `asset` as a string, or null when it holds no line. */
export async function balanceOf(account: string, asset: Asset): Promise<string | null> {
  const { balances } = await horizon.loadAccount(account);
  const line = balances.find((b) =>
    asset.isNative()
      ? b.asset_type === "native"
      : "asset_code" in b && b.asset_code === asset.code && b.asset_issuer === asset.issuer,
  );
  return line?.balance ?? null;
}

/** Runs a snippet's main and prints the error, if any, without a stack dump. */
export function run(main: () => Promise<void>): void {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
    process.exitCode = 1;
  });
}
