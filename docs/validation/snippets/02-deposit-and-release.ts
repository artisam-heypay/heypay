// docs/validation/snippets/02-deposit-and-release.ts
//
// The happy path: the payer locks 10 XLM under a job id, the merchant is paid
// off-chain, and the admin releases the job. A second release is refused at
// simulation, so a job settles exactly once.
//
//   pnpm exec tsx docs/validation/snippets/02-deposit-and-release.ts
import { Asset } from "@stellar/stellar-sdk";
import {
  EscrowRejected,
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

run(async () => {
  const [admin, payer] = await Promise.all([fundedAccount(), fundedAccount()]);
  const { contractId } = await deployEscrow(admin, tokenOf(Asset.native()));
  const jobId = jobIdFor(`order-${Date.now()}`);

  // deposit: the payer signs; the 10 XLM move from the payer into the contract.
  const depositTx = await send(
    "deposit",
    await escrowClient(contractId, payer).deposit({
      job_id: jobId,
      from: payer.publicKey(),
      amount: toStroops(10),
    }),
  );
  const held = await readJob(contractId, jobId);
  console.log("deposit", txUrl(depositTx));
  console.log(
    "  job",
    held.status,
    `${held.amount} stroops, deadline ledger ${held.deadline_ledger}`,
  );

  // release: only the admin can, and the funds can only go to the admin.
  const releaseTx = await send(
    "release",
    await escrowClient(contractId, admin).release({ job_id: jobId }),
  );
  console.log("release", txUrl(releaseTx));
  console.log("  job", (await readJob(contractId, jobId)).status);

  try {
    await send("release", await escrowClient(contractId, admin).release({ job_id: jobId }));
    throw new Error("a second release went through");
  } catch (err) {
    if (!(err instanceof EscrowRejected)) throw err;
    console.log("second release refused:", err.code);
  }
});
