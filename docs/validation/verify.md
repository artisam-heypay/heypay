# Check HeyPay's claims on Stellar Expert

This page is for a reviewer who wants to check, claim by claim, that HeyPay
did what its Instawards statement of work (SOW) says. No technical background
is needed. Each claim has one link. Open it, and compare the page with "What
you should see" under the claim.

You only need a web browser. There is nothing to install, and no account,
wallet or login.

## Before you start

**Stellar Expert** is a public website that shows everything recorded on the
Stellar network: every account, payment and contract. HeyPay does not run it
and cannot change what it shows.

**Testnet is play money.** HeyPay ran these payments on Stellar Testnet, the
practice network that Stellar keeps for testing. It works the same way as the
main network, but its XLM and USDC have no value. Every link below opens
Stellar Expert on Testnet: its address starts with
`stellar.expert/explorer/testnet/`.

**Addresses are shortened.** A Stellar address is 56 characters long, so
Stellar Expert shows only its first and last characters, such as
`GC7R…36IQ`. In the Summary box it shows two more on each side, such as
`GC7RS4…J436IQ`. Compare the first and last characters. Account addresses
start with G, contract addresses with C.

These are the addresses you will meet on this page:

| Shown as    | What it is                                                                    |
| ----------- | ----------------------------------------------------------------------------- |
| `CA3I…BT7J` | HeyPay's escrow contract for XLM                                              |
| `CAR7…66EG` | HeyPay's escrow contract for USDC                                             |
| `GDZ2…IN37` | the HeyPay treasury, the escrow's operator ("admin")                          |
| `GC7R…36IQ` | a payer's HeyPay wallet, used in the final run of 2026-10-20                  |
| `GCGE…RXJO` | HeyPay's sponsor account, which pays the small XLM reserve a new wallet needs |
| `GDY2…UBH6` | a payer's own Freighter wallet; HeyPay never had its key                      |
| `GBBD…FLA5` | the issuer of Circle's Testnet USDC                                           |

### How to read a transaction page

1. **Summary**, at the top. "Status: Successful" means the network accepted
   the transaction. "Processed" is its date and time in UTC. "Source Account"
   is the account that sent it.
2. **The operation**, in the box under the Summary. For the escrow it reads
   like "`GC7R…36IQ` invoked contract `CA3I…BT7J`
   deposit(…)": who acted, on which contract, and which function. Amounts
   inside the brackets are in stroops: 10,000,000 stroops are 1 XLM, or
   1 USDC.
3. **The details.** Click the arrow at the right of the operation box. Lines
   such as "… XLM debited from account …" and "… XLM credited to contract …"
   show the money moving. A line "Contract `CA3I…BT7J` raised event
   ["escrow", "deposit", …]" is the escrow's own public record of what it did.
4. **Signatures**, at the bottom: the accounts that signed the transaction.

The first value inside a call's brackets is the payment's job id, a code like
`prkLhWEO…`. The deposit of a payment and its release or refund
carry the same job id.

## D1: The settlement escrow

The escrow is a contract on Stellar that holds the payer's crypto while
HeyPay pays the merchant in pesos. It hands the crypto to HeyPay only once the
merchant is paid, and gives it back to the payer if the payout fails.

### 1. HeyPay's escrow contract is live on Testnet and runs the published code

**Link:** [Contract `CA3I…BT7J` on Stellar Expert](https://stellar.expert/explorer/testnet/contract/CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J)

**What you should see:**

- The title "Contract CA3IHLNNIMJEOXGQ4NNJIQCTWGW3X4NEQWVIVFWM3EHVCEFBZ73OBT7J".
- In Summary, "Type: WASM contract" and "Hash: f3ccfe37…43872f60". This hash is
  the fingerprint of the code the contract runs.
- The same hash, in full, on HeyPay's public release
  [`escrow-v1.0-testnet`](https://github.com/artisam-heypay/heypay/releases/tag/escrow-v1.0-testnet),
  under "The WASM":
  `f3ccfe37fa39403a82bc835f18f0b68c83d1503a5d058ec02ae5878143872f60`.
  Matching hashes mean the contract runs exactly the code HeyPay published.
- The **Interface** tab lists the contract's functions, among them `deposit`,
  `release`, `refund` and `refund_after_timeout`.

"Source code: Unavailable" in the Summary only means the code was not sent to
Stellar Expert's own source-checking service. The hash above is the check.
HeyPay's USDC escrow, `CAR7…66EG` (claims 9 to 11), shows the same hash.

### 2. A payment's crypto is locked in the escrow, not sent to HeyPay

**Link:** [Transaction `962bd508…` on Stellar Expert](https://stellar.expert/explorer/testnet/tx/962bd508efc741b48daf6cd5d3d542b3db86e88f21f6557da6c1c9426048654c)

**What you should see:**

- Source Account `GC7RS4…J436IQ`: the payer's wallet.
- The operation "`GC7R…36IQ` invoked contract `CA3I…BT7J`
  deposit(…, `GC7R…36IQ`, 142857243)".
- In the details: "14.2857243 XLM debited from account
  `GC7R…36IQ`" and "14.2857243 XLM credited to contract
  `CA3I…BT7J`", and the event ["escrow", "deposit", …].
- Processed 2026-10-20 08:07:37 UTC.

### 3. Once the merchant is paid, the escrow releases the crypto to HeyPay

**Link:** [Transaction `bcdaeba9…` on Stellar Expert](https://stellar.expert/explorer/testnet/tx/bcdaeba93c9dfab9927eb5da405bae09eab378fd9953508d6035479206986842)

**What you should see:**

- Source Account `GDZ2BQ…KLIN37`: the HeyPay treasury.
- The operation "`GDZ2…IN37` invoked contract `CA3I…BT7J`
  release(…)", with the same job id as the deposit in claim 2
  (`prkLhWEO…`).
- In the details: "14.2857243 XLM debited from contract `CA3I…BT7J`"
  and "credited to account `GDZ2…IN37`", the same amount that was
  locked, and the event ["escrow", "release", …].
- Processed 2026-10-20 08:08:27 UTC.

`release` takes no destination address, so the escrow can only pay the
treasury, or give the money back to the payer.

### 4. When the merchant payout fails, the escrow refunds the payer

This payment was for PHP 66.66, the amount the test setup uses to make the
merchant payout fail. Its deposit is in the
[receipt list](receipts.md#final-run-2026-10-20).

**Link:** [Transaction `595591a7…` on Stellar Expert](https://stellar.expert/explorer/testnet/tx/595591a728023ef26ad7694adffc363180f7228b93826ae5b80fe5b2bae06bd1)

**What you should see:**

- Source Account `GDZ2BQ…KLIN37`: HeyPay, acting on the failed payout.
- The operation "`GDZ2…IN37` invoked contract `CA3I…BT7J`
  refund(…)".
- In the details: "19.0457243 XLM debited from contract `CA3I…BT7J`"
  and "credited to account `GC7R…36IQ`". The money goes back to the
  payer, not to the treasury.
- The event ["escrow", "refund", …].
- Processed 2026-10-20 08:08:52 UTC.

### 5. After the deadline, the payer takes the money back alone

Every deposit records a deadline. Once it passes, the payer's own account can
call `refund_after_timeout` and take back what the escrow holds, without
waiting for HeyPay. Only the payer's account can make this call, and only
after the deadline; HeyPay's admin key cannot. In this payment the deadline
passed before the merchant payout started, so HeyPay cancelled the payment and
the payer took the money back with "Get my money back".

**Link:** [Transaction `c6dff26c…` on Stellar Expert](https://stellar.expert/explorer/testnet/tx/c6dff26caa74328dcb028b2471a03117de3bebcc16d6949ab1431e8a0e8c968d)

**What you should see:**

- Source Account `GC7RS4…J436IQ`: the payer, not the treasury.
- The operation "`GC7R…36IQ` invoked contract `CA3I…BT7J`
  refund_after_timeout(…)".
- In the details: "14.2857243 XLM debited from contract
  `CA3I…BT7J`" and "credited to account `GC7R…36IQ`", and the event
  ["escrow", "refund_timeout", …].
- Under Signatures, one signature only, from `GC7RS4…J436IQ`. The treasury
  `GDZ2…IN37` did not sign.
- Processed 2026-10-20 08:06:47 UTC.

This payer used a HeyPay wallet. A payer with their own wallet makes the same
call with their own key; those receipts are in the
[receipt list](receipts.md), under D3.

## D2: USDC, held and refunded as USDC

USDC is a dollar stablecoin. HeyPay has a second escrow for it,
`CAR7…66EG`, so a USDC payment stays USDC from start to end.

### 6. A new payer wallet can hold USDC, and HeyPay pays for it

On Stellar, an account must agree to hold an asset such as USDC before it can
receive it. That agreement is called a trustline, and it ties up a small XLM
reserve. HeyPay pays that reserve for new wallets.

**Link:** [Transaction `8899baa1…` on Stellar Expert](https://stellar.expert/explorer/testnet/tx/8899baa17bbd35573d1fb6f0f770583de33815af228345edf4d593e12d717482)

**What you should see:**

- Source Account `GCGEGL…GBRXJO`: HeyPay's sponsor account.
- Four lines: "`GCGE…RXJO` sponsored reserves for `GC7R…36IQ`",
  "`GCGE…RXJO` created account `GC7R…36IQ` with starting
  balance 0 XLM", "`GC7R…36IQ` established trustline to USDC
  `GBBD…FLA5`", and "Finished sponsoring reserves for
  `GC7R…36IQ`".
- Under Signatures, `GCGEGL…GBRXJO` and `GC7RS4…J436IQ`: HeyPay pays,
  and the payer agrees to hold USDC.
- Processed 2026-10-20 08:01:17 UTC.

### 7. The swap page trades XLM for USDC

**Link:** [Transaction `c677a500…` on Stellar Expert](https://stellar.expert/explorer/testnet/tx/c677a50045eefd3b59baea3f5ee54b897a2965176350fcd783b3cea5d42e1770)

**What you should see:**

- Source Account `GC7RS4…J436IQ`.
- One line "`GC7R…36IQ` swapped", with 20 XLM going
  in and 17.6325671 USDC coming out.
- Processed 2026-10-20 08:09:07 UTC.

### 8. The swap page trades USDC back for XLM

**Link:** [Transaction `2dc894e3…` on Stellar Expert](https://stellar.expert/explorer/testnet/tx/2dc894e353bedab058e5244d2db041f07841147acc84dd38be85ff84a2885a9b)

**What you should see:**

- Source Account `GC7RS4…J436IQ`.
- One line "`GC7R…36IQ` swapped", with 0.495 USDC going
  in and 4.1249999 XLM coming out.
- Processed 2026-10-20 08:10:52 UTC.

### 9. A USDC payment is locked in the escrow as USDC

**Link:** [Transaction `4a588ee5…` on Stellar Expert](https://stellar.expert/explorer/testnet/tx/4a588ee541669e7ce0448e181c0dbb7cd3344ed16aad572db9dbfc2b956a4ffb)

**What you should see:**

- Source Account `GC7RS4…J436IQ`.
- The operation "`GC7R…36IQ` invoked contract `CAR7…66EG`
  deposit(…, `GC7R…36IQ`, 8620690)".
- In the details: "0.862069 USDC `GBBD…FLA5` debited from account
  `GC7R…36IQ`" and "credited to contract `CAR7…66EG`". The asset is
  USDC, not XLM.
- The event ["escrow", "deposit", …].
- Processed 2026-10-20 08:09:27 UTC.

### 10. Once the merchant is paid, the escrow releases the same USDC

**Link:** [Transaction `32dfffa8…` on Stellar Expert](https://stellar.expert/explorer/testnet/tx/32dfffa81fafedb506ee058683d3abe193c10a2844eb15ec0c2d4151b36ebad0)

**What you should see:**

- Source Account `GDZ2BQ…KLIN37`.
- The operation "`GDZ2…IN37` invoked contract `CAR7…66EG`
  release(…)", with the same job id as claim 9 (`CjZK7Y3L…`).
- In the details: "0.862069 USDC debited from contract `CAR7…66EG`"
  and "credited to account `GDZ2…IN37`", and the event
  ["escrow", "release", …].
- Processed 2026-10-20 08:10:22 UTC.

### 11. When the payout fails, the payer gets USDC back, not XLM

Another PHP 66.66 payment, paid in USDC, whose merchant payout was made to
fail.

**Link:** [Transaction `b5e3f706…` on Stellar Expert](https://stellar.expert/explorer/testnet/tx/b5e3f7068ce1811c3a2a93857d227797ef21a8cf59e04560ed8d1c50391a5ecd)

**What you should see:**

- Source Account `GDZ2BQ…KLIN37`.
- The operation "`GDZ2…IN37` invoked contract `CAR7…66EG`
  refund(…)".
- In the details: "1.1493104 USDC debited from contract `CAR7…66EG`"
  and "credited to account `GC7R…36IQ`". The payer gets back USDC, the
  asset they paid with.
- The event ["escrow", "refund", …].
- Processed 2026-10-20 08:10:42 UTC.

## D3: The payer signs with their own wallet

Freighter is a wallet that runs in the payer's browser. With it, the payer
keeps their own key, and HeyPay never sees it: the payer approves each payment
in Freighter. These two transactions are a payment of PHP 10.00 made on
HeyPay's deployed app and approved in the Freighter extension. (In the final
run of 2026-10-20, a test key stood in for Freighter, so the receipts here are
the earlier ones from the real extension.)

### 12. A payment signed only by the payer's own Freighter key goes into the escrow

**Link:** [Transaction `0bdb40e7…` on Stellar Expert](https://stellar.expert/explorer/testnet/tx/0bdb40e758849d197c50004658a02e76e4fadb0eaf06c49d2c3777b51d29899e)

**What you should see:**

- Source Account `GDY2RN…Q7UBH6`: the payer's own Freighter account.
- The operation "`GDY2…UBH6` invoked contract `CA3I…BT7J`
  deposit(…, `GDY2…UBH6`, 8855043)".
- In the details: "0.8855043 XLM debited from account
  `GDY2…UBH6`" and "credited to contract `CA3I…BT7J`".
- Under Signatures, one signature only, from `GDY2RN…Q7UBH6`. No HeyPay
  key signed.
- Processed 2026-10-15 11:24:32 UTC.

### 13. HeyPay settles that payment without ever holding the payer's key

**Link:** [Transaction `c1763a2b…` on Stellar Expert](https://stellar.expert/explorer/testnet/tx/c1763a2b16637d8b0985d78ef625d849d73aaefe76b3110888281ac4480c0720)

**What you should see:**

- Source Account `GDZ2BQ…KLIN37`.
- The operation "`GDZ2…IN37` invoked contract `CA3I…BT7J`
  release(…)", with the same job id as claim 12 (`N0aOmT7a…`).
- In the details: "0.8855043 XLM debited from contract `CA3I…BT7J`"
  and "credited to account `GDZ2…IN37`".
- Processed 2026-10-15 11:26:22 UTC.

## D4: The validation package

### 14. Every on-chain claim has a receipt, checked on the chain

**Link:** [On-chain receipt list](receipts.md)

**What you should see:**

- A "SOW targets" table at the top, with every target marked "Met" by the
  final run of 2026-10-20 alone.
- Tables of transactions, each row with a Stellar Expert link like the ones on
  this page, grouped by deliverable: first the final run, then the earlier
  receipts.
- A note that a script made the list from the chain itself: it opened every
  transaction and checked that it succeeded, and that it called the function
  named on the contract named. Anyone can run the same check with
  `node scripts/receipts.mjs --check`.

### 15. Another Stellar project can reuse the escrow, with code to copy

**Link:** [Integration guide](integration-guide.md)

**What you should see:**

- Sections for each step: set up an escrow, deposit then release or refund,
  the payer's refund after the deadline, USDC, and signing with Freighter.
  Each has code to copy, taken from a file that runs on Testnet.
- A "What is published" table linking the compiled contract, its interface,
  sample events, and the [SDK and API reference](escrow-sdk.md).

Technical demo video: link to come.

The demo walks through the same claims on Stellar Expert. Its script is
[demo-script.md](demo-script.md).
