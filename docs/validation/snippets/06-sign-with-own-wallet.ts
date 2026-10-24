// docs/validation/snippets/06-sign-with-own-wallet.ts
//
// Non-custodial deposit: the payer signs with their own wallet and the server
// never holds their key. Four steps, in the order HeyPay runs them:
//
//   1. prepare (server)  says what the deposit must be
//   2. build   (browser) builds and simulates it, the payer's account as source
//   3. sign    (wallet)  Freighter signs; here a Keypair stands in for it
//   4. check + submit (server) refuses anything but exactly that deposit, then sends it
//
// In the browser, replace `signWithKeypair` with `signWithFreighter` from
// ./freighter.ts.
//
//   pnpm exec tsx docs/validation/snippets/06-sign-with-own-wallet.ts
import {
  Address,
  Asset,
  BASE_FEE,
  Contract,
  FeeBumpTransaction,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  type Transaction,
  type xdr,
} from "@stellar/stellar-sdk";
import {
  NETWORK_PASSPHRASE,
  RPC_URL,
  deployEscrow,
  escrowClient,
  fundedAccount,
  jobIdFor,
  readJob,
  run,
  send,
  toStroops,
  tokenOf,
  txUrl,
} from "./shared";

/** What the server hands the browser: every value comes from the payment. */
type DepositInstructions = {
  contractId: string;
  /** The payer's own account: the transaction's source and the deposit's `from`. */
  from: string;
  /** Hex of the 32-byte job id. */
  jobId: string;
  /** Stroops, as a string: an i128 does not fit a JSON number. */
  amount: string;
  networkPassphrase: string;
  rpcUrl: string;
  /** ISO time after which the network no longer takes the transaction. */
  validUntil: string;
};

const depositArgs = (i: DepositInstructions): xdr.ScVal[] => [
  nativeToScVal(Buffer.from(i.jobId, "hex"), { type: "bytes" }),
  new Address(i.from).toScVal(),
  nativeToScVal(BigInt(i.amount), { type: "i128" }),
];

// 1. Server: what the deposit must be. Valid for two minutes and no longer.
function prepareDeposit(contractId: string, payer: string, orderId: string): DepositInstructions {
  return {
    contractId,
    from: payer,
    jobId: jobIdFor(orderId).toString("hex"),
    amount: toStroops(2).toString(),
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    validUntil: new Date(Date.now() + 120_000).toISOString(),
  };
}

// 2. Browser: the unsigned deposit, simulated. Nothing is signed or sent.
async function buildDeposit(i: DepositInstructions): Promise<string> {
  const server = new rpc.Server(i.rpcUrl);
  const raw = new TransactionBuilder(await server.getAccount(i.from), {
    fee: BASE_FEE,
    networkPassphrase: i.networkPassphrase,
    // A max time of 0 would mean "never expires".
    timebounds: { minTime: 0, maxTime: Math.floor(Date.parse(i.validUntil) / 1000) },
  })
    .addOperation(new Contract(i.contractId).call("deposit", ...depositArgs(i)))
    .build();

  const sim = await server.simulateTransaction(raw);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`Simulation failed: ${sim.error}`);
  // The payer's signature on the envelope must be the only authorisation needed.
  const sourceOnly = (sim.result?.auth ?? []).every(
    (entry) => entry.credentials().switch().name === "sorobanCredentialsSourceAccount",
  );
  if (!sourceOnly) throw new Error("The deposit asks for a signature besides the payer's");
  return rpc.assembleTransaction(raw, sim).build().toXDR();
}

// 3. Wallet: stands in for Freighter when the snippet runs under Node.
function signWithKeypair(unsignedXdr: string, payer: Keypair): string {
  const tx = TransactionBuilder.fromXDR(unsignedXdr, NETWORK_PASSPHRASE) as Transaction;
  tx.sign(payer);
  return tx.toXDR();
}

// 4a. Server: the signed transaction must be exactly the prepared deposit.
function checkSignedDeposit(signedXdr: string, i: DepositInstructions): Transaction {
  const tx = TransactionBuilder.fromXDR(signedXdr, i.networkPassphrase);
  if (tx instanceof FeeBumpTransaction) throw new Error("A fee bump is not the payer's own");
  if (tx.source !== i.from) throw new Error("Not from the payer's account");

  const [op, ...others] = tx.operations;
  if (!op || others.length > 0 || op.type !== "invokeHostFunction") {
    throw new Error("Not a single contract call");
  }
  if (op.source !== undefined && op.source !== i.from) throw new Error("Operation source differs");
  if (op.func.switch().name !== "hostFunctionTypeInvokeContract") throw new Error("Not a call");
  const call = op.func.invokeContract();
  const expectedArgs = depositArgs(i).map((a) => a.toXDR("base64"));
  const sameCall =
    Address.fromScAddress(call.contractAddress()).toString() === i.contractId &&
    call.functionName().toString() === "deposit" &&
    call.args().length === expectedArgs.length &&
    call.args().every((arg, n) => arg.toXDR("base64") === expectedArgs[n]);
  if (!sameCall) throw new Error("Not the deposit that was prepared");

  const maxTime = Number(tx.timeBounds?.maxTime ?? 0) * 1000;
  if (maxTime <= 0 || maxTime > Date.parse(i.validUntil)) throw new Error("Validity too long");
  if (maxTime <= Date.now()) throw new Error("Expired");

  const key = Keypair.fromPublicKey(i.from);
  const signed = tx.signatures.some((s) => key.verify(tx.hash(), s.signature()));
  if (!signed) throw new Error("Not signed by the payer's key");
  return tx;
}

// 4b. Server: send it exactly as it came, and wait for the result.
async function submit(tx: Transaction): Promise<string> {
  const server = new rpc.Server(RPC_URL);
  const sent = await server.sendTransaction(tx);
  if (sent.status !== "PENDING" && sent.status !== "DUPLICATE") {
    throw new Error(`Network did not take the deposit: ${sent.status}`);
  }
  const done = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (done.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Deposit ${sent.hash} ended ${done.status}`);
  }
  return sent.hash;
}

run(async () => {
  const [admin, payer] = await Promise.all([fundedAccount(), fundedAccount()]);
  const { contractId } = await deployEscrow(admin, tokenOf(Asset.native()));

  const instructions = prepareDeposit(contractId, payer.publicKey(), `order-${Date.now()}`);
  const unsigned = await buildDeposit(instructions);
  const signed = signWithKeypair(unsigned, payer);

  // A deposit signed by any other key is refused before the network sees it.
  try {
    checkSignedDeposit(signWithKeypair(unsigned, Keypair.random()), instructions);
  } catch (err) {
    console.log("signed by another key:", (err as Error).message);
  }

  const depositTx = await submit(checkSignedDeposit(signed, instructions));
  const jobId = Buffer.from(instructions.jobId, "hex");
  console.log("deposit", txUrl(depositTx), "(source and only signature: the payer)");
  console.log("  job", (await readJob(contractId, jobId)).status);

  // The operator settles as usual; it never needed the payer's key.
  const releaseTx = await send(
    "release",
    await escrowClient(contractId, admin).release({ job_id: jobId }),
  );
  console.log("release", txUrl(releaseTx));
});
