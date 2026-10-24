// docs/validation/snippets/04-refund-after-timeout.ts
//
// The operator never acts: once the job's deadline ledger is reached, the
// payer takes the funds back with their own signature. Before the deadline the
// contract refuses with DeadlineNotReached. The admin plays no part in the
// refund; here it only shortens the window so the run takes seconds, not a day.
//
//   pnpm exec tsx docs/validation/snippets/04-refund-after-timeout.ts
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
  sorobanRpc,
  toStroops,
  tokenOf,
  txUrl,
} from "./shared";

/** Ledgers close about every 5 seconds on Testnet. */
const WINDOW_LEDGERS = 4;

run(async () => {
  const [admin, payer] = await Promise.all([fundedAccount(), fundedAccount()]);
  const { contractId } = await deployEscrow(admin, tokenOf(Asset.native()));

  // Admin-only, and it only affects deposits made after it.
  const timeoutTx = await send(
    "set_timeout",
    await escrowClient(contractId, admin).set_timeout({ ledgers: WINDOW_LEDGERS }),
  );
  console.log("set_timeout", txUrl(timeoutTx));

  const jobId = jobIdFor(`order-${Date.now()}`);
  const depositTx = await send(
    "deposit",
    await escrowClient(contractId, payer).deposit({
      job_id: jobId,
      from: payer.publicKey(),
      amount: toStroops(3),
    }),
  );
  const { deadline_ledger: deadline } = await readJob(contractId, jobId);
  console.log("deposit    ", txUrl(depositTx));
  console.log("  deadline ledger", deadline);

  const payerClient = escrowClient(contractId, payer);
  try {
    await send("refund_after_timeout", await payerClient.refund_after_timeout({ job_id: jobId }));
  } catch (err) {
    if (!(err instanceof EscrowRejected)) throw err;
    console.log("  too early:", err.code);
  }

  for (;;) {
    const { sequence } = await sorobanRpc.getLatestLedger();
    if (sequence >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const refundTx = await send(
    "refund_after_timeout",
    await payerClient.refund_after_timeout({ job_id: jobId }),
  );
  console.log("refund_after_timeout", txUrl(refundTx), "(signed by the payer)");
  console.log("  job", (await readJob(contractId, jobId)).status);
});
