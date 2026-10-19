// docs/validation/snippets/03-deposit-and-refund.ts
//
// The payout failed: the admin calls refund() and the held 5 XLM go back to the
// payer. `refund` takes no destination; the contract pays the job's `from`.
//
//   pnpm exec tsx docs/validation/snippets/03-deposit-and-refund.ts
import { Asset } from "@stellar/stellar-sdk";
import {
  balanceOf,
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

  const depositTx = await send(
    "deposit",
    await escrowClient(contractId, payer).deposit({
      job_id: jobId,
      from: payer.publicKey(),
      amount: toStroops(5),
    }),
  );
  const afterDeposit = await balanceOf(payer.publicKey(), Asset.native());
  console.log("deposit", txUrl(depositTx));
  console.log("  payer XLM", afterDeposit);

  const refundTx = await send(
    "refund",
    await escrowClient(contractId, admin).refund({ job_id: jobId }),
  );
  const afterRefund = await balanceOf(payer.publicKey(), Asset.native());
  console.log("refund ", txUrl(refundTx));
  console.log("  payer XLM", afterRefund, "(5 XLM back; the admin paid the refund's fee)");
  console.log("  job", (await readJob(contractId, jobId)).status);
});
