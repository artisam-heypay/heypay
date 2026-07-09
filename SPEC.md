# SPEC.md — HeyPay Full-Stack Application Specification

> **Audience:** a code-expert AI agent building HeyPay end to end.
> **Read `AGENT.md` for engineering/security rules and `BRAND.md` for theming.**
> This document defines scope, data model, pages, API endpoints, background jobs,
> and third-party integrations precisely enough to implement without guessing.

---

## 1. Product summary

HeyPay lets a **Payer** pay any **QRPH** merchant in the Philippines using their
**Stellar (XLM)** balance held in a HeyPay custodial wallet. HeyPay converts XLM
to PHP via the **PDAX** exchange API and settles PHP into the merchant's
registered **PH bank account**.

### Happy path (QRPH shown to payer)

1. Payer opens HeyPay and authenticates.
2. Payer scans an existing QRPH code (or uploads an image of it).
3. The QRPH resolves to a **registered HeyPay merchant**.
4. Payer confirms; payment is funded with **XLM** (USDT/USDC are future scope).
5. HeyPay **sells XLM → PHP** via the PDAX trade API.
6. HeyPay **sends PHP → merchant's PH bank account** via the PDAX cash-out API.

### Merchant setup

A business owner creates a **Merchant** account and saves (a) the **decoded value
of their QRPH** and (b) the **bank account** that will receive PHP.

### Scope for this version

- Web only (responsive; desktop + mobile web).
- Payers hold **custodial** Stellar wallets inside HeyPay.
- Payers **prefund** their account with XLM; payments draw from the prefunded
  balance.
- Demo showcases: **merchant transaction history** (XLM + PHP) and **payer
  personal transaction history**.
- Authentication is **basic username + password**, with a **seeded admin**.

### Explicitly out of scope (note as TODO/feature-flag stubs)

- USDT / USDC payment assets (model for it; gate behind a flag).
- KYC/AML onboarding, real OTP/2FA UX, fraud scoring.
- Mobile native apps.
- Real money movement in non-production environments (use PDAX **staging** +
  Stellar **testnet**; provide a `MOCK` provider mode for local dev/demo).

---

## 2. Personas & roles

| Role       | Description                                                                              | Key surfaces  |
| ---------- | ---------------------------------------------------------------------------------------- | ------------- |
| `ADMIN`    | Seeded operator account. Can view users, merchants, all transactions, and system health. | `/admin/*`    |
| `PAYER`    | Consumer with a custodial XLM wallet. Prefunds, scans, pays, views own history.          | `/payer/*`    |
| `MERCHANT` | Business owner. Onboards QRPH + bank, receives PHP, views business history.              | `/merchant/*` |

A single `User` has exactly one `role`. A `MERCHANT` user also has one `Merchant`
profile; a `PAYER` user has one `CustodialWallet`. (Keep them separable so a
future user could hold both; for v1 enforce one role per user.)

---

## 3. Architecture overview

- **Single Next.js app (App Router)** providing both the UI (React Server/Client
  Components) and the backend (Route Handlers under `app/api/**` + Server
  Actions for form mutations).
- **PostgreSQL** (Railway) via **Prisma 7** ORM.
- **Redis** (Railway plugin / local docker) backing a **BullMQ** job queue for
  the asynchronous settlement pipeline (Stellar submit → PDAX trade → PDAX
  cash-out) plus balance reconciliation.
- **Object storage** for uploaded QRPH images and merchant logos: Railway volume
  or Railway-hosted S3-compatible bucket in prod; **MinIO** locally. Accessed
  through an `S3`-compatible client so prod/dev are interchangeable.
- **Stellar**: `@stellar/stellar-sdk` talks to **Horizon** (account/balance/
  payments) on **testnet** (dev) / **mainnet** (prod).
- **PDAX REST API**: server-side only, HMAC-signed, for rate quotes, XLM→PHP
  trades, PHP bank cash-out, and transaction status.
- A small **worker process** (same repo, separate Railway service) runs the
  BullMQ consumers. The web service only enqueues jobs.

```
[Browser]
   │  (HTTPS, session cookie)
   ▼
[Next.js web service] ── Prisma ──> [Postgres]
   │  enqueue jobs                     ▲
   ├──> [Redis / BullMQ] <──── [Worker service] ──> [Stellar Horizon]
   │                                   └──────────> [PDAX REST API]
   └──> [S3 / MinIO]  (QRPH + logo uploads)
```

### Settlement state machine (a `Payment`)

```
CREATED
  → QUOTED            (rate locked, XLM amount computed)
  → AUTHORIZED        (payer confirmed; funds reserved from wallet balance)
  → STELLAR_SUBMITTED (XLM moved custodial → HeyPay PDAX deposit address)
  → STELLAR_CONFIRMED (Horizon confirms tx)
  → PDAX_TRADING      (sell XLM → PHP requested)
  → PDAX_TRADED       (trade filled; PHP credited in PDAX)
  → PAYOUT_SUBMITTED  (cash_out to merchant bank requested)
  → SETTLED           (payout confirmed)            [terminal, success]
  → FAILED            (any step failed; see failureReason) [terminal]
  → REFUND_PENDING / REFUNDED  (XLM returned to payer wallet)  [terminal]
```

Each transition is persisted, idempotent, and retried with backoff by the worker.

---

## 4. Data model (Prisma 7 schema)

PostgreSQL. Use `cuid()` ids, `DateTime` timestamps, and store all monetary
values as **`Decimal`** (never floats). XLM has **7 decimal places (stroops)**;
PHP uses 2. Encrypt wallet secrets at rest (see AGENT.md §Security).

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client"          // Prisma 7 Rust-free generator
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role { ADMIN PAYER MERCHANT }

enum PaymentAsset { XLM USDC USDT }   // only XLM enabled in v1

enum PaymentStatus {
  CREATED QUOTED AUTHORIZED
  STELLAR_SUBMITTED STELLAR_CONFIRMED
  PDAX_TRADING PDAX_TRADED
  PAYOUT_SUBMITTED SETTLED
  FAILED REFUND_PENDING REFUNDED
}

enum WalletTxType { PREFUND_DEPOSIT PAYMENT_DEBIT REFUND_CREDIT ADJUSTMENT }
enum MerchantStatus { DRAFT PENDING_REVIEW ACTIVE SUSPENDED }

model User {
  id           String   @id @default(cuid())
  username     String   @unique
  passwordHash String                      // argon2id
  role         Role
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  wallet       CustodialWallet?
  merchant     Merchant?
  sessions     Session[]
  paymentsMade Payment[] @relation("PayerPayments")
  auditLogs    AuditLog[]
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  // store a hash of the session token, never the raw token
  tokenHash String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())
  ip        String?
  userAgent String?
  @@index([userId])
}

model CustodialWallet {
  id                 String   @id @default(cuid())
  userId             String   @unique
  user               User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  stellarPublicKey   String   @unique            // G...
  encryptedSecret    String                      // envelope-encrypted S... (AES-256-GCM)
  secretKeyVersion   Int      @default(1)        // for key rotation
  // cached balance from Horizon; source of truth is Horizon + ledger
  cachedXlmBalance   Decimal  @default(0) @db.Decimal(20, 7)
  reservedXlm        Decimal  @default(0) @db.Decimal(20, 7) // in-flight payments
  lastSyncedAt       DateTime?
  createdAt          DateTime @default(now())
  walletTxs          WalletTransaction[]
}

model WalletTransaction {
  id            String       @id @default(cuid())
  walletId      String
  wallet        CustodialWallet @relation(fields: [walletId], references: [id])
  type          WalletTxType
  amountXlm     Decimal      @db.Decimal(20, 7)  // signed: + credit, - debit
  balanceAfter  Decimal      @db.Decimal(20, 7)
  stellarTxHash String?      @unique
  paymentId     String?
  memo          String?
  createdAt     DateTime     @default(now())
  @@index([walletId, createdAt])
}

model Merchant {
  id                String         @id @default(cuid())
  userId            String         @unique
  user              User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  businessName      String
  logoKey           String?                        // S3 object key
  status            MerchantStatus @default(DRAFT)

  // QRPH
  qrphRaw           String                         // raw decoded EMVCo string
  qrphImageKey      String?                        // uploaded image (optional)
  qrphMerchantName  String?                        // tag 59
  qrphMerchantCity  String?                        // tag 60
  qrphMerchantId    String?                        // acquirer/merchant identifier
  qrphAcquirerId    String?
  qrphCountry       String?        @default("PH")  // tag 58
  qrphCurrency      String?        @default("608") // tag 53 (PHP=608)

  // settlement bank account (receives PHP)
  settlementBankCode   String                      // e.g. BPI, BDO, GCASH, MAYA
  settlementBankName   String
  accountName          String
  accountNumber        String                      // store encrypted; mask in UI
  accountNumberLast4   String

  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt

  payments          Payment[]
  @@index([status])
}

model ExchangeRateSnapshot {
  id         String   @id @default(cuid())
  pair       String                              // "XLMPHP"
  rate       Decimal  @db.Decimal(20, 8)         // 1 XLM = rate PHP
  source     String   @default("PDAX")
  fetchedAt  DateTime @default(now())
  @@index([pair, fetchedAt])
}

model Payment {
  id                String        @id @default(cuid())
  reference         String        @unique         // human-facing TXN-XXXX
  payerId           String
  payer             User          @relation("PayerPayments", fields: [payerId], references: [id])
  merchantId        String
  merchant          Merchant      @relation(fields: [merchantId], references: [id])

  asset             PaymentAsset  @default(XLM)
  amountPhp         Decimal       @db.Decimal(14, 2)   // requested PHP amount
  quotedRate        Decimal       @db.Decimal(20, 8)   // locked XLM→PHP rate
  amountXlm         Decimal       @db.Decimal(20, 7)   // XLM debited from payer
  networkFeeXlm     Decimal       @db.Decimal(20, 7) @default(0)
  pdaxFeePhp        Decimal       @db.Decimal(14, 2) @default(0)
  netSettledPhp     Decimal?      @db.Decimal(14, 2)   // PHP actually paid out

  status            PaymentStatus @default(CREATED)
  failureReason     String?

  // external references
  stellarTxHash     String?       @unique
  pdaxTradeRef      String?
  pdaxCashoutRef    String?

  quoteExpiresAt    DateTime?
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
  settledAt         DateTime?

  events            PaymentEvent[]
  @@index([payerId, createdAt])
  @@index([merchantId, createdAt])
  @@index([status])
}

model PaymentEvent {
  id         String        @id @default(cuid())
  paymentId  String
  payment    Payment       @relation(fields: [paymentId], references: [id], onDelete: Cascade)
  fromStatus PaymentStatus?
  toStatus   PaymentStatus
  detail     Json?
  createdAt  DateTime      @default(now())
  @@index([paymentId, createdAt])
}

model AuditLog {
  id        String   @id @default(cuid())
  actorId   String?
  actor     User?    @relation(fields: [actorId], references: [id])
  action    String                          // e.g. "merchant.create"
  target    String?                         // entity id
  metadata  Json?
  ip        String?
  createdAt DateTime @default(now())
  @@index([actorId, createdAt])
}

model IdempotencyKey {
  id         String   @id @default(cuid())
  key        String   @unique
  scope      String                         // e.g. "payment.create"
  response   Json?
  createdAt  DateTime @default(now())
  expiresAt  DateTime
}
```

### Seed script (`prisma/seed.ts`)

- Create the **admin** user from env (`ADMIN_USERNAME`, `ADMIN_PASSWORD`) with
  `role=ADMIN`, password hashed with **argon2id**. Idempotent (upsert by username).
- Optionally seed a **demo payer** (with a testnet custodial wallet that is
  friendbot-funded) and a **demo merchant** (with a sample decoded QRPH and a
  masked test bank account) when `SEED_DEMO=true`, so the demo flows work
  immediately.
- Wire via Prisma 7 `prisma.config.ts` (the `seed` is run with
  `pnpm prisma db seed`; configure the command in `prisma.config.ts`).

---

## 5. Pages / routes (App Router)

All authenticated routes are protected by middleware (`proxy.ts` in Next 16) that
checks the session cookie and the route's required role; unauthorized → `/login`,
wrong role → `403`. Use route groups `(auth)`, `(payer)`, `(merchant)`, `(admin)`.

### Public / auth

| Route     | Type                        | Purpose                                                                  |
| --------- | --------------------------- | ------------------------------------------------------------------------ |
| `/`       | Server                      | Marketing/redirect: if authed, send to role dashboard; else to `/login`. |
| `/login`  | Client form → Server Action | Username + password sign-in.                                             |
| `/signup` | Client form                 | Create `PAYER` or `MERCHANT` account (role chooser).                     |
| `/logout` | Action                      | Destroy session, redirect to `/login`.                                   |

### Payer

| Route                            | Purpose                                                                                                                                                                                 | Mirrors mock      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `/payer/dashboard`               | Total balance (XLM + ≈PHP), Prefund/Send, Scan QRPH CTA, recent payments, prefund panel (custodial address + QR + copy), network status.                                                | _Payer Dashboard_ |
| `/payer/scan`                    | Scan QRPH via camera (getUserMedia) **or** upload QR image. Decodes → resolves merchant → routes to confirm.                                                                            | _Scan flow_       |
| `/payer/pay/[paymentId]/confirm` | Confirm screen: merchant info, requested PHP, **live PDAX conversion** (rate, total XLM deduction, network fee), wallet source, Confirm/Cancel. Confirm → processing overlay → success. | _Confirm Payment_ |
| `/payer/prefund`                 | Custodial XLM deposit address + QR, network reminder (Stellar, no memo), pending deposit detection.                                                                                     | _Prefund Account_ |
| `/payer/transactions`            | Personal transaction history (XLM debited + PHP, merchant, status, date). Detail drawer per tx.                                                                                         | _Recent Payments_ |
| `/payer/settings`                | Profile, change password.                                                                                                                                                               | —                 |

### Merchant

| Route                    | Purpose                                                                                                                                                                                                                   | Mirrors mock            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `/merchant/onboarding`   | 4-step wizard: (1) Business Identity, (2) Settlement Account (bank radio-cards + account number), (3) Link QRPH (upload image or scan), (4) Final Review → "Go Live". Live payer-preview pane.                            | _Merchant Onboarding_   |
| `/merchant/dashboard`    | Earnings (Total Settled PHP + MoM), Pending XLM trades, Business Transactions table (customer, received XLM, settlement PHP, status), Business QR + settlement bank, support card, setup-completion banner if incomplete. | _Merchant Dashboard_    |
| `/merchant/transactions` | Full settlement history with filters (status, date range), CSV export.                                                                                                                                                    | _Business Transactions_ |
| `/merchant/qr`           | View/download business QRPH, share payment link.                                                                                                                                                                          | _My Business QR_        |
| `/merchant/settings`     | Edit business name/logo, bank account, re-link QRPH, change password.                                                                                                                                                     | —                       |

### Admin

| Route              | Purpose                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `/admin`           | System overview: counts, volume (XLM/PHP), recent failures.          |
| `/admin/users`     | List/search users, deactivate.                                       |
| `/admin/merchants` | Review/activate/suspend merchants.                                   |
| `/admin/payments`  | All payments with full state timeline; manual retry/refund triggers. |
| `/admin/health`    | Stellar/PDAX/Redis connectivity, queue depth.                        |

---

## 6. API endpoints (Route Handlers)

Base: `/api`. All return JSON. Mutations require a valid session cookie and CSRF
protection (see AGENT.md). Money-moving POSTs accept an `Idempotency-Key` header.
Validate every input with **Zod**. Use proper status codes and a consistent error
envelope: `{ "error": { "code": string, "message": string, "details"?: any } }`.

### Auth

| Method | Path                 | Body                             | Returns                   | Notes                                               |
| ------ | -------------------- | -------------------------------- | ------------------------- | --------------------------------------------------- |
| POST   | `/api/auth/signup`   | `{username, password, role}`     | `{user}` + session cookie | role ∈ {PAYER, MERCHANT}. Creates wallet for PAYER. |
| POST   | `/api/auth/login`    | `{username, password}`           | `{user}` + session cookie | Rate-limited; generic error on failure.             |
| POST   | `/api/auth/logout`   | —                                | `204`                     | Revokes session.                                    |
| GET    | `/api/auth/session`  | —                                | `{user                    | null}`                                              | Current session. |
| POST   | `/api/auth/password` | `{currentPassword, newPassword}` | `204`                     | Re-auth required.                                   |

### Payer wallet

| Method | Path                                      | Returns                                                         | Notes                                                                            |
| ------ | ----------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/api/wallet`                             | `{publicKey, balanceXlm, reservedXlm, availableXlm, approxPhp}` | Available = balance − reserved.                                                  |
| GET    | `/api/wallet/deposit-address`             | `{publicKey, qrSvg, network:"stellar", memoRequired:false}`     | For prefund.                                                                     |
| POST   | `/api/wallet/sync`                        | `{balanceXlm}`                                                  | Reconcile from Horizon; also detects new prefund deposits → `WalletTransaction`. |
| GET    | `/api/wallet/transactions?cursor=&limit=` | `{items, nextCursor}`                                           | Wallet ledger (deposits/debits/refunds).                                         |

### QRPH + payments (payer)

| Method | Path                         | Body                            | Returns                                                                  | Notes                                                                                                                                |
| ------ | ---------------------------- | ------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/api/qrph/decode`           | `{raw?}` or multipart `{image}` | `{decoded, merchant?}`                                                   | Parses EMVCo QRPH; resolves to a registered `Merchant`. If amount is embedded (tag 54) include it.                                   |
| POST   | `/api/payments/quote`        | `{merchantId, amountPhp}`       | `{paymentId, amountPhp, rate, amountXlm, networkFeeXlm, quoteExpiresAt}` | Locks a rate snapshot (TTL ~60–120s). Creates `Payment(status=QUOTED)`. Verifies payer has sufficient available XLM.                 |
| POST   | `/api/payments/[id]/confirm` | `{}` + `Idempotency-Key`        | `{paymentId, status}`                                                    | Requires quote not expired & funds available. Reserves XLM, sets `AUTHORIZED`, enqueues settlement job. Returns immediately (async). |
| GET    | `/api/payments/[id]`         | `{payment, events}`             | —                                                                        | Poll for live status (drives the processing overlay). Consider SSE (`/api/payments/[id]/stream`).                                    |
| POST   | `/api/payments/[id]/cancel`  | —                               | `{status}`                                                               | Only if not yet `STELLAR_SUBMITTED`.                                                                                                 |

### Merchant

| Method | Path                                                   | Body                                          | Returns                   | Notes                                                              |
| ------ | ------------------------------------------------------ | --------------------------------------------- | ------------------------- | ------------------------------------------------------------------ |
| POST   | `/api/merchant`                                        | `{businessName}`                              | `{merchant}`              | Step 1. Creates `DRAFT`.                                           |
| GET    | `/api/merchant/me`                                     | —                                             | `{merchant}`              | —                                                                  |
| PATCH  | `/api/merchant/me`                                     | partial                                       | `{merchant}`              | Update business/bank fields.                                       |
| POST   | `/api/merchant/settlement`                             | `{bankCode, accountName, accountNumber}`      | `{merchant}`              | Step 2. Validates bank code; stores encrypted account no. + last4. |
| POST   | `/api/merchant/qrph`                                   | `{raw?}` or multipart `{image}`               | `{merchant, decoded}`     | Step 3. Decode + persist QRPH + uploaded image to S3.              |
| POST   | `/api/merchant/go-live`                                | —                                             | `{merchant}`              | Step 4. Validates completeness → `ACTIVE` (or `PENDING_REVIEW`).   |
| GET    | `/api/merchant/transactions?status=&from=&to=&cursor=` | `{items, nextCursor}`                         | Settlement history.       |
| GET    | `/api/merchant/earnings`                               | `{totalSettledPhp, momChangePct, pendingXlm}` | Dashboard cards.          |
| GET    | `/api/merchant/qr`                                     | `{qrphRaw, qrSvg, paymentLink}`               | Business QR + share link. |

### File uploads

| Method | Path                   | Returns              | Notes                                                                                                                 |
| ------ | ---------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/uploads/presign` | `{url, fields, key}` | Presigned S3/MinIO POST for QRPH/logo. Validate content-type + size server-side; re-validate the object after upload. |

### Admin

`GET /api/admin/overview`, `GET /api/admin/users`, `PATCH /api/admin/users/[id]`
(activate/deactivate), `GET /api/admin/merchants`, `PATCH /api/admin/merchants/[id]`
(status), `GET /api/admin/payments`, `POST /api/admin/payments/[id]/retry`,
`POST /api/admin/payments/[id]/refund`, `GET /api/admin/health`. All require
`role=ADMIN`.

### Webhooks (server-to-server)

| Method | Path                 | Notes                                                                                                                                                                                                                                                  |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/api/webhooks/pdax` | Receive PDAX trade/cash-out status callbacks **if** the partner integration provides them. Verify signature/allowlist source IP. If PDAX offers no webhook for the relevant event, fall back to **polling** in the worker. Idempotent by external ref. |

---

## 7. Third-party integrations

### 7.1 Stellar (`@stellar/stellar-sdk` v15.x)

- **Networks:** testnet (`https://horizon-testnet.stellar.org`, friendbot for
  funding) in dev; mainnet (`https://horizon.stellar.org`) in prod. Drive via
  `STELLAR_NETWORK`, `STELLAR_HORIZON_URL`, `STELLAR_NETWORK_PASSPHRASE`.
- **Custodial wallets:** on PAYER signup, generate a `Keypair`, store the public
  key, and store the secret **envelope-encrypted** (AES-256-GCM with a KMS/master
  key; never plaintext, never client-side). Use `sodium-native` for fast signing
  in the backend.
- **Prefund detection:** poll Horizon `payments().forAccount(pubkey)` (cursor
  persisted) or stream; credit `WalletTransaction(PREFUND_DEPOSIT)` and update
  cached balance. Account must be created/funded (≥1 XLM base reserve) before use;
  surface "activate by depositing ≥ X XLM".
- **Paying:** build a `payment` operation moving the payer's `amountXlm +
networkFeeXlm` from the custodial account to **HeyPay's PDAX XLM deposit
  address** (`PDAX_XLM_DEPOSIT_ADDRESS`), with a memo tying it to the `Payment`
  (`MEMO_TEXT` or `MEMO_ID`). Sign server-side, submit via Horizon, store
  `stellarTxHash`, wait for confirmation (poll tx result).
- **Amounts:** XLM strings with ≤7 decimals; use BigNumber/Decimal, never JS
  floats. Set `setTimeout(...)` (timebounds) and a sane `fee` (`fetchBaseFee`).

### 7.2 PDAX REST API (server-side only)

Reference: PDAX Exchange REST API (`https://doc.restapi.pdax.ph`).

- **Base URLs:** staging `https://services-stage.pdax.ph/api/exchange/v1`;
  production base from PDAX once credentialed (`institutions.pdax.ph`). Drive via
  `PDAX_BASE_URL`.
- **Auth:** every request signed with headers **`Access-Key`** and
  **`Access-Signature`** (HMAC of the request using the secret). Implement a
  signing helper; keep `PDAX_ACCESS_KEY` / `PDAX_SECRET` server-side only.
- **OTP/2FA:** crypto withdrawals require an OTP (TOTP) — store `PDAX_TOTP_SECRET`
  and derive codes via the API's OTP mechanism. **FIAT (PHP) cash-out does not
  require OTP.**
- **Endpoints used (names per PDAX docs; confirm exact paths/payloads against the
  live docs at build time):**
  - **Rates / quote:** retrieve supported cryptos and prevailing rate for
    `XLMPHP` → used by `/api/payments/quote`. Persist an `ExchangeRateSnapshot`.
  - **Request trade (sell):** sell `XLM` for `PHP` (`traded_currency=XLM`,
    `settlement_currency=PHP`). Returns a reference; **fees are charged on the
    settlement currency (PHP)**.
  - **Check exchange status:** poll by reference until filled → `PDAX_TRADED`.
  - **Cash-out (`cash_out`):** withdraw PHP from the PHP wallet to the merchant's
    bank account (bank-specific payload: bank code, account name/number). No OTP.
    Returns `pdaxCashoutRef`.
  - **Transactions (`transaction`):** list/inspect withdrawals, deposits, trades
    for reconciliation.
- **Terminology:** `traded_currency` = first in pair (XLM); `settlement_currency`
  = second (PHP).
- **Provider abstraction:** wrap all of the above behind a `PaymentRailProvider`
  interface with two implementations: `PdaxProvider` (real) and `MockProvider`
  (deterministic, for local dev/demo, configurable rate + simulated delays).
  Select via `PAYMENT_RAIL=pdax|mock`.

### 7.3 QRPH decoding

- QRPH follows the **EMVCo merchant-presented QR** spec (BSP National QR Standard).
  Parse the TLV string: tag `00` (payload format), `01` (point of init: 11 static
  / 12 dynamic), merchant account info templates (`26`–`51`), `52` MCC, `53`
  currency (`608`=PHP), `54` amount (optional, present for dynamic QR), `58`
  country (`PH`), `59` merchant name, `60` city, `62` additional data, `63` CRC.
- **Validate the CRC** (CRC-16/CCITT-FALSE over the payload up to and including
  the `6304` tag) before trusting a code.
- From an uploaded image, decode with a QR reader (e.g. `jsQR`/`zxing`) to recover
  the raw string, then TLV-parse. From camera, decode client-side then POST the
  raw string to `/api/qrph/decode` for authoritative server validation + merchant
  resolution.
- **Merchant resolution:** match decoded merchant identifier(s) to a registered
  `Merchant.qrphMerchantId`/`qrphRaw`. If no match → "merchant not registered
  with HeyPay".

### 7.4 Railway (infra)

- **Postgres** plugin → `DATABASE_URL`.
- **Redis** plugin → `REDIS_URL` (BullMQ).
- **Object storage**: Railway volume mounted to the worker/web, or a Railway
  S3-compatible bucket; expose via `S3_*` envs so MinIO (dev) and Railway (prod)
  share one client.
- **Services:** `web` (Next.js) and `worker` (BullMQ consumers) as two Railway
  services from the same repo; shared env group. Run `prisma migrate deploy` on
  release.

---

## 8. Core flows (sequence detail)

### 8.1 Payer prefund

1. `/payer/prefund` → `GET /api/wallet/deposit-address` shows `G...` + QR + "use
   Stellar network, no memo required".
2. Payer sends XLM from an external wallet/exchange.
3. Worker's **deposit poller** sees the incoming Horizon payment → creates
   `WalletTransaction(PREFUND_DEPOSIT)`, updates `cachedXlmBalance`.
4. Dashboard balance updates (poll or SSE).

### 8.2 Pay a merchant (the headline flow)

1. `/payer/scan` decodes QRPH (camera/upload) → `POST /api/qrph/decode` →
   resolves `Merchant` (+ embedded amount if dynamic QR; else prompt for amount).
2. `POST /api/payments/quote {merchantId, amountPhp}` → locks rate, computes
   `amountXlm` + `networkFeeXlm`, checks available balance, returns `Payment`
   (`QUOTED`) + `quoteExpiresAt`. UI renders the **Confirm** screen.
3. `POST /api/payments/[id]/confirm` (idempotent): re-checks quote freshness +
   available balance, **reserves** `amountXlm+fee` (`reservedXlm += …`), sets
   `AUTHORIZED`, enqueues `settlePayment` job, returns immediately. UI shows the
   processing overlay and polls `GET /api/payments/[id]`.
4. **Worker `settlePayment`** (idempotent, resumable per status):
   - `AUTHORIZED → STELLAR_SUBMITTED`: build/sign/submit XLM payment custodial→
     `PDAX_XLM_DEPOSIT_ADDRESS` with memo=payment ref; save `stellarTxHash`.
   - `→ STELLAR_CONFIRMED`: poll Horizon tx success; on success debit wallet
     (`WalletTransaction(PAYMENT_DEBIT)`, release reservation), else `FAILED`.
   - `→ PDAX_TRADING → PDAX_TRADED`: request XLM→PHP trade, poll status until
     filled; record `pdaxTradeRef`, `pdaxFeePhp`.
   - `→ PAYOUT_SUBMITTED → SETTLED`: `cash_out` PHP to merchant bank; poll/await
     callback; record `pdaxCashoutRef`, `netSettledPhp`, `settledAt`.
   - Any failure → `FAILED` with `failureReason`; if XLM already left the wallet
     but PHP didn't settle, branch to `REFUND_PENDING` and return XLM to the
     payer (or credit equivalent), alert admin.
5. UI overlay reflects each step; on `SETTLED` shows success ("₱X sent to
   {merchant}").

### 8.3 Merchant onboarding

Steps map 1:1 to the wizard. `go-live` requires: business name, decoded+CRC-valid
QRPH, and a settlement bank account. On success status → `ACTIVE` (or
`PENDING_REVIEW` if you keep an admin gate).

---

## 9. Validation, money & correctness rules

- **Decimals only** for money (Prisma `Decimal` + `decimal.js`/BigNumber in code).
  XLM 7 dp, PHP 2 dp. Round half-up at display; never accumulate float error.
- **Rate locking:** a confirmed payment must use the `quotedRate`; if the quote
  expired, force a re-quote. Store the snapshot used.
- **Idempotency** on every money-moving action (`Idempotency-Key` + `IdempotencyKey`
  table; worker jobs keyed by `paymentId`+`status`).
- **Sufficient funds:** quote and confirm both check `availableXlm` =
  `cachedXlmBalance − reservedXlm`.
- **Reconciliation job:** periodically diff wallet ledger vs Horizon balance and
  PDAX `transaction` history vs local `Payment` records; flag drift to admin.
- **Single source of truth:** Horizon for XLM, PDAX for PHP legs; local DB caches
  for UX but reconciles against externals.

---

## 10. Non-functional requirements

- **Security:** see `AGENT.md` (auth, secrets, encryption, headers, rate limits).
- **Observability:** structured logs with a `paymentId` correlation id; capture
  every `PaymentEvent`; health endpoint; error tracking (e.g. Sentry).
- **Performance:** dashboards server-rendered with cached aggregates; lists
  cursor-paginated; balance via cache + background sync.
- **Resilience:** all external calls timeout + retry with exponential backoff +
  jitter; circuit-break PDAX/Horizon; jobs are at-least-once and idempotent.
- **Testing:** unit (QRPH TLV+CRC parser, fee/quote math, state machine), integration
  (API handlers with a test Postgres), e2e (Playwright: signup → prefund(mock) →
  scan → pay → settle; merchant onboarding → go-live → see settlement). Use the
  `MockProvider` + Stellar testnet so the full happy path runs in CI.
- **Accessibility & responsiveness:** per `BRAND.md` (WCAG AA, reduced motion,
  mobile bottom nav).

---

## 11. Environment variables (summary)

See `AGENT.md`/`.env.example` for the authoritative list. Key groups:
`DATABASE_URL`, `SHADOW_DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`,
`ENCRYPTION_MASTER_KEY` (+ key version), `ADMIN_USERNAME`/`ADMIN_PASSWORD`,
`STELLAR_NETWORK`/`STELLAR_HORIZON_URL`/`STELLAR_NETWORK_PASSPHRASE`,
`PDAX_BASE_URL`/`PDAX_ACCESS_KEY`/`PDAX_SECRET`/`PDAX_TOTP_SECRET`/
`PDAX_XLM_DEPOSIT_ADDRESS`, `PAYMENT_RAIL`, `S3_ENDPOINT`/`S3_BUCKET`/
`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_REGION`, `APP_URL`.

---

## 12. Deliverables checklist

- [ ] Next.js 16 (App Router) app: payer, merchant, admin surfaces per §5, themed per `BRAND.md`.
- [ ] All API endpoints in §6 with Zod validation + consistent error envelope.
- [ ] Prisma 7 schema (§4) + migrations + idempotent `seed.ts` (admin + optional demo).
- [ ] `PaymentRailProvider` with `PdaxProvider` and `MockProvider`.
- [ ] Stellar custodial wallet service (gen/encrypt/sign/submit/poll).
- [ ] QRPH EMVCo TLV parser + CRC-16 validation (+ image decode).
- [ ] BullMQ worker: settlement state machine, deposit poller, reconciliation.
- [ ] Auth (username/password, argon2id, server sessions, CSRF, rate limiting).
- [ ] Docker Compose for local Postgres + Redis + MinIO; `.env.example`.
- [ ] Railway config: `web` + `worker` services, Postgres/Redis plugins, storage, `migrate deploy` on release.
- [ ] Tests (unit/integration/e2e) green in CI with mock rail + testnet.
