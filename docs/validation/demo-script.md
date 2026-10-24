# Technical demo script (3–5 min)

A technical walkthrough, not a marketing video. Every claim is shown on
Stellar Expert (Testnet) as it is made. Nine shots, about 4 minutes 45 seconds.
The narration is about 550 words: about 4 minutes read aloud at 140 words a
minute. The rest is time on screen with no voice, mostly in shots 6 and 7.

Shots 2, 3 and 7 are recorded live: a payment on the deployed app
(`app.heypayfi.xyz`), and a payment approved in the Freighter extension. Shots
4, 5 and 6 open transactions from the
[final run of 2026-10-20](receipts.md#final-run-2026-10-20), because a payout
failure cannot be forced on cue on the deployed app, and a deadline refund
needs the merchant payout to stall. Every transaction named below is also in
the [receipt list](receipts.md).

## Before recording

- Screen at 1920×1080. Browser zoom 125% so hashes are readable. App in a phone
  frame (DevTools device mode, 390×844) on the left half; Stellar Expert on the
  right half.
- Tabs open, in order: the app signed in as a payer with XLM, the escrow
  contract page, the `escrow-v1.0-testnet` release page, a terminal in the repo,
  and each Stellar Expert link in the tables below.
- Freighter installed, on Testnet, with a funded account connected in the app
  under Settings. On the dashboard, keep the HeyPay wallet in use until shot 7.
- A merchant QR to scan: the practice shop's QR on a second screen or printed.
- Turn off notifications. Record the voice separately if the room is noisy.

## Shot list

| #   | Time      | Shot                                       | Length |
| --- | --------- | ------------------------------------------ | ------ |
| 1   | 0:00–0:45 | The escrow contract and its published code | 45 s   |
| 2   | 0:45–1:15 | A payment from the HeyPay wallet           | 30 s   |
| 3   | 1:15–1:50 | Deposit and release on Stellar Expert      | 35 s   |
| 4   | 1:50–2:20 | Payout fails: the escrow refunds           | 30 s   |
| 5   | 2:20–2:50 | Deadline passes: the payer refunds alone   | 30 s   |
| 6   | 2:50–3:25 | USDC: trustline, swap, hold and refund     | 35 s   |
| 7   | 3:25–4:05 | A payment signed in Freighter              | 40 s   |
| 8   | 4:05–4:35 | The receipt list                           | 30 s   |
| 9   | 4:35–4:45 | Close                                      | 10 s   |

---

### 1. The escrow contract and its published code (0:00–0:45)

**On screen:** Stellar Expert, contract
[`CA3I…BT7J`](https://stellar.expert/explorer/testnet/contract/CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J).
Then the release page
[`escrow-v1.0-testnet`](https://github.com/artisam-heypay/heypay/releases/tag/escrow-v1.0-testnet).
Then the terminal:

```sh
stellar contract fetch --network testnet -o deployed.wasm \
  --id CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J
shasum -a 256 deployed.wasm
```

**Point at on Stellar Expert:** the contract's WASM hash, `f3ccfe37…2f60`, and
the list of functions: `deposit`, `release`, `refund`, `refund_after_timeout`.

**Say:**

> This is HeyPay's settlement escrow, a Soroban contract on Stellar Testnet. It
> holds the crypto leg of every QR Ph payment under a job id. Only two things
> can end a job: the operator releases it to the treasury once the merchant is
> paid, or refunds it to the payer if the payout fails. Once a deadline ledger
> passes, the payer can also take it back alone. The code running here is the
> WASM in our public release: the hash Stellar Expert shows, the hash in the
> release, and the hash of the fetched code are the same.

### 2. A payment from the HeyPay wallet (0:45–1:15)

**On screen:** the app. Scan the shop's QR, type ₱50, Continue, then the
confirm screen and its pay button ("Pay up to … XLM"). Let the progress screen
run to the success screen.

**Say:**

> A payer scans an ordinary QR Ph code, the same one the shop already uses for
> bank transfers, and enters fifty pesos. HeyPay quotes the XLM and locks the
> rate. On confirm, the payment's crypto does not go to HeyPay directly. It goes
> into the escrow, and stays there until the merchant's peso payout has an
> answer.

### 3. Deposit and release on Stellar Expert (1:15–1:50)

**On screen:** in the app, open the payment from History. Under Timeline,
open "Escrow deposit on Stellar", then "Escrow release on Stellar". If the
payment just made is slow, use the final-run pair:

| What                  | Transaction                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Deposit, TXN-PBWHHZOW | [`962bd508…`](https://stellar.expert/explorer/testnet/tx/962bd508efc741b48daf6cd5d3d542b3db86e88f21f6557da6c1c9426048654c) |
| Release, the same job | [`bcdaeba9…`](https://stellar.expert/explorer/testnet/tx/bcdaeba93c9dfab9927eb5da405bae09eab378fd9953508d6035479206986842) |

**Point at:** on the deposit, the source account (the payer's wallet), the
call `deposit` on `CA3I…BT7J`, and the transfer into the contract. On the
release, the source (the treasury, which is the escrow's admin), the call
`release` with the same job id, and the transfer out of the contract to the
treasury.

**Say:**

> Here is the deposit. The payer's wallet called deposit on the escrow, and the
> XLM moved into the contract. Here is the release, made once the merchant was
> paid. The admin called release with the same job id, and the same amount
> moved out to the treasury. Release takes no destination, so even the admin
> key can only send held funds to the admin, or back to the payer.

### 4. Payout fails: the escrow refunds (1:50–2:20)

**On screen:** two transactions from the final run, a payment whose payout
was made to fail.

| What                             | Transaction                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Deposit, TXN-WOWSKLRP, PHP 66.66 | [`34ffaf89…`](https://stellar.expert/explorer/testnet/tx/34ffaf895e8e809a0c59058210ee216db2332dbfb76422571544d7f2b44ed4b0) |
| Refund after the payout failed   | [`595591a7…`](https://stellar.expert/explorer/testnet/tx/595591a728023ef26ad7694adffc363180f7228b93826ae5b80fe5b2bae06bd1) |

**Point at:** the call `refund`, the transfer from the contract back to the
payer's wallet (not to the treasury), and the event `escrow` / `refund`.

**Say:**

> Now the case the escrow exists for. This payment's peso payout failed. HeyPay
> did not send the payer a new payment from its own funds. The admin called
> refund on the contract, and the contract returned exactly what it held to the
> account it came from. The contract emits a refund event that anyone can read.

### 5. Deadline passes: the payer refunds alone (2:20–2:50)

**On screen:** the final-run payment that passed its deadline before its payout
started.

| What                                          | Transaction                                                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Deposit, TXN-7VGHDCYD, with a 3-ledger window | [`7e561a5e…`](https://stellar.expert/explorer/testnet/tx/7e561a5e82a524cb392fd8f555529e4b1fe795e1ed8da53fbc30411b3927ee48) |
| `refund_after_timeout`, signed by the payer   | [`c6dff26c…`](https://stellar.expert/explorer/testnet/tx/c6dff26caa74328dcb028b2471a03117de3bebcc16d6949ab1431e8a0e8c968d) |

**Point at:** on the refund, the source account is the payer's wallet, not the
treasury; the call `refund_after_timeout`; the event `escrow` /
`refund_timeout`.

**Say:**

> What if the operator never acts? Each deposit records a deadline ledger. This
> payment's deadline passed before its payout started, so the app cancelled it
> and offered the payer "Get my money back". The refund you see was sent from
> the payer's own account, calling refund after timeout. The admin did not sign
> it. Before the deadline, the contract refuses this call.

### 6. USDC: trustline, swap, hold and refund (2:50–3:25)

**On screen:** the final-run USDC transactions, one after another.

| What                                         | Transaction                                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| USDC turned on by the payer ("Turn on USDC") | [`861bc97b…`](https://stellar.expert/explorer/testnet/tx/861bc97b25a1e9a9bdcf9d37bfe8e0f0f69f1c7b9e7aece651ed0c1f3181dc97) |
| Swap XLM → USDC (strict send)                | [`c677a500…`](https://stellar.expert/explorer/testnet/tx/c677a50045eefd3b59baea3f5ee54b897a2965176350fcd783b3cea5d42e1770) |
| USDC deposit, TXN-FXZVPCAZ                   | [`4a588ee5…`](https://stellar.expert/explorer/testnet/tx/4a588ee541669e7ce0448e181c0dbb7cd3344ed16aad572db9dbfc2b956a4ffb) |
| USDC release                                 | [`32dfffa8…`](https://stellar.expert/explorer/testnet/tx/32dfffa81fafedb506ee058683d3abe193c10a2844eb15ec0c2d4151b36ebad0) |
| USDC refund after a failed payout            | [`b5e3f706…`](https://stellar.expert/explorer/testnet/tx/b5e3f7068ce1811c3a2a93857d227797ef21a8cf59e04560ed8d1c50391a5ecd) |
| Swap USDC → XLM (strict receive)             | [`2dc894e3…`](https://stellar.expert/explorer/testnet/tx/2dc894e353bedab058e5244d2db041f07841147acc84dd38be85ff84a2885a9b) |

**Point at:** the `change_trust` operation, sent and signed by the payer's own account with no sponsor; the path payment's
two assets; the USDC escrow `CAR7…66EG` on the deposit, release and refund,
and that the refund's transfer is USDC.

**Say:**

> USDC works the same way, with its own escrow instance. The payer turns it on
> in the app: one trustline, sent from the payer's own account, which sets aside
> its own reserve. The swap page trades XLM for USDC on the Stellar DEX, and
> back. A USDC payment is held as USDC, released as USDC, and when the payout
> fails, refunded as USDC, not converted to XLM.

### 7. A payment signed in Freighter (3:25–4:05)

**On screen:** live. On the app's dashboard, on the "Your own wallet" card
(Freighter), press "Use this wallet". Pay the shop ₱10. On the confirm screen press "Sign with Freighter". Freighter opens:
hold on the request so its details are readable (contract call `deposit` on
`CA3I…BT7J`), then approve. Open the payment's "Escrow deposit on Stellar".
If Freighter misbehaves, use the earlier receipt approved in the extension:
deposit
[`0bdb40e7…`](https://stellar.expert/explorer/testnet/tx/0bdb40e758849d197c50004658a02e76e4fadb0eaf06c49d2c3777b51d29899e),
release
[`c1763a2b…`](https://stellar.expert/explorer/testnet/tx/c1763a2b16637d8b0985d78ef625d849d73aaefe76b3110888281ac4480c0720).

**Point at:** the deposit's source account is the Freighter account, and the
transaction has one signature, from that account.

**Say:**

> HeyPay normally holds the payer's key. With their own wallet switched on,
> it does not. The server says what the deposit must be, the browser builds it,
> and Freighter shows the payer the exact contract call before they approve.
> HeyPay checks that the signed transaction is that deposit and nothing else,
> then sends it. On Stellar Expert, the source is the payer's Freighter account,
> and it is the only signature. HeyPay never had this key.

### 8. The receipt list (4:05–4:35)

**On screen:** [`receipts.md`](receipts.md) on GitHub: scroll the SOW targets
table, then the final run's tables. Then the terminal:

```sh
node scripts/receipts.mjs --check
```

**Point at:** every target "Met" by the final run alone; the printed line "All
60 transactions and 4 contracts check out." (a higher count once the payments
from shots 2 and 7 are added).

**Say:**

> Every claim has a receipt. This list is generated from the chain, not typed
> in: a script fetches each transaction and checks that it succeeded, that it
> called the function named, on the contract named, and, where the payer signed,
> that the treasury did not. It also checks that each contract runs the
> published WASM. Anyone can run it.

### 9. Close (4:35–4:45)

**On screen:** the integration guide's title, with its URL visible.

**Say:**

> The contract, the integration guide with copyable code, and this list are all
> public. Links are below the video.

## After recording

- Put the integration guide, the receipt list and the release in the video
  description.
- Note the hashes of the payments made live in shots 2 and 7, so they can be
  added to `receipts.json`.
