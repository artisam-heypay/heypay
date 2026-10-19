// docs/validation/snippets/01-deploy-and-initialize.ts
//
// Creates your own escrow instance from the published WASM and initializes it:
// you are the admin, and it holds native XLM.
//
//   pnpm exec tsx docs/validation/snippets/01-deploy-and-initialize.ts
import { Asset } from "@stellar/stellar-sdk";
import {
  contractUrl,
  deployEscrow,
  escrowClient,
  fundedAccount,
  run,
  tokenOf,
  txUrl,
} from "./shared";

run(async () => {
  const admin = await fundedAccount();
  const { contractId, deployTx, initTx } = await deployEscrow(admin, tokenOf(Asset.native()));

  // Read the setup back: getters need no signature.
  const reader = escrowClient(contractId);
  const [storedAdmin, token, timeout] = await Promise.all([
    reader.admin().then((tx) => tx.result.unwrap()),
    reader.token().then((tx) => tx.result.unwrap()),
    reader.timeout().then((tx) => tx.result),
  ]);

  console.log("escrow    ", contractUrl(contractId));
  console.log("deploy    ", txUrl(deployTx));
  console.log("initialize", txUrl(initTx));
  console.log("admin     ", storedAdmin, storedAdmin === admin.publicKey() ? "(you)" : "");
  console.log("token     ", token, "(native XLM)");
  console.log("timeout   ", timeout, "ledgers before a payer can self-refund");
});
