# AGENT.md — HeyPay Coding Agent Guide

> Operating manual for the AI agent building HeyPay. Read with `SPEC.md`
> (what to build) and `BRAND.md` (how it looks). This file defines the **tech
> stack, project conventions, and application + security best practices** that
> are non-negotiable. HeyPay moves real money (XLM ⇄ PHP); treat correctness and
> security as first-class requirements, not afterthoughts.

---

## 0. Prime directives

1. **Latest stable dependencies.** Pin to the newest stable releases (see §2).
   Before finalizing `package.json`, run `pnpm outdated` and resolve to current
   stable; never ship known-vulnerable versions (`pnpm audit` must be clean).
2. **Security best practices everywhere** (§6). Money + custodial keys raise the bar.
3. **Idempotent, resumable money flows.** Every external side effect is retry-safe.
4. **No secrets or private keys in client code, logs, git, or the browser.**
5. **Type-safe end to end.** TypeScript `strict`, Zod at every boundary, Prisma types.
6. **Provider abstraction for external rails** so dev/demo runs without real money.

---

## 1. Tech stack (authoritative)

| Layer               | Choice                                                                       |
| ------------------- | ---------------------------------------------------------------------------- |
| Framework (FE + BE) | **Next.js (App Router)** — Server Components, Server Actions, Route Handlers |
| Language            | **TypeScript** (`strict: true`)                                              |
| Runtime             | **Node.js 22 LTS** (Next 16 requires Node ≥ 20.9; use 22 LTS)                |
| Package manager     | **pnpm** (`packageManager` field pinned; use a lockfile)                     |
| ORM                 | **Prisma 7** (Rust-free client, `prisma.config.ts`, driver adapter)          |
| Database            | **PostgreSQL** (Railway in prod; docker locally)                             |
| Cache / queue       | **Redis** + **BullMQ** (Railway/docker)                                      |
| Styling             | **Tailwind CSS v4** (CSS-first `@theme`; see `BRAND.md`)                     |
| Object storage      | **S3-compatible** — Railway storage (prod) / **MinIO** (dev)                 |
| Auth                | **Username + password**, server sessions, **argon2id**, seeded admin         |
| Blockchain          | **`@stellar/stellar-sdk` v15.x** (Horizon)                                   |
| Payment rail        | **PDAX REST API** (server-side, HMAC-signed) behind a provider interface     |
| Deployment          | **Railway** (`web` + `worker` services)                                      |
| Validation          | **Zod**                                                                      |
| Tests               | **Vitest** (unit/integration) + **Playwright** (e2e)                         |
| Lint/format         | **ESLint** (flat config) + **Prettier** + **TypeScript**                     |

> Do not introduce a separate Express/Nest backend — Next.js Route Handlers +
> Server Actions are the backend. The only second process is the BullMQ worker.

---

## 2. Dependency versions (use latest stable at build time)

Resolve these to current stable with `pnpm add <pkg>@latest` and verify on npm.
As of this writing the current stable lines are:

- `next` **16.2.x**, `react` / `react-dom` **19.2.x** (Next 16 = Turbopack
  default, async request APIs, middleware file is `proxy.ts`).
- `prisma` + `@prisma/client` **7.x** (generator `provider = "prisma-client"`,
  `prisma.config.ts`, **driver adapter** e.g. `@prisma/adapter-pg` + `pg`).
- `tailwindcss` **4.x** with `@tailwindcss/postcss` (CSS-first; **no**
  `tailwind.config.js` needed — define tokens in `@theme`, see `BRAND.md §9`).
- `@stellar/stellar-sdk` **15.x** (use the scoped package, **not** legacy
  `stellar-sdk`). Add `sodium-native` for fast backend signing.
- `bullmq` (latest), `ioredis` (latest).
- `zod` (latest), `argon2` (latest), `jose` (latest, for signed cookies/tokens).
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (latest) for S3/MinIO.
- `decimal.js` (or `bignumber.js`) for money math.
- QR: `jsqr` or `@zxing/library` (decode), `qrcode` (render deposit/business QR).
- Tooling: `typescript` 5.x, `vitest`, `@playwright/test`, `eslint`, `prettier`,
  `tsx` (run TS scripts/seed).

**Rule:** if a newer stable major exists when you build, adopt it and adjust to
its breaking changes (read its upgrade guide) rather than pinning to an older one.
Run `pnpm audit --prod` and fix before delivery.

---

## 3. Project structure

```
heypay/
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/
│  └─ seed.ts
├─ prisma.config.ts            # Prisma 7 config (schema path, migrations, seed)
├─ src/
│  ├─ app/                     # App Router
│  │  ├─ (auth)/login, signup
│  │  ├─ (payer)/payer/...
│  │  ├─ (merchant)/merchant/...
│  │  ├─ (admin)/admin/...
│  │  ├─ api/                  # Route Handlers (see SPEC §6)
│  │  └─ globals.css           # Tailwind v4 @theme (BRAND.md)
│  ├─ proxy.ts                 # Next 16 middleware (authz, security headers)
│  ├─ server/
│  │  ├─ auth/                 # sessions, password, csrf, rate-limit
│  │  ├─ db.ts                 # Prisma client singleton (+ driver adapter)
│  │  ├─ stellar/              # wallet service (gen/encrypt/sign/submit/poll)
│  │  ├─ rails/                # PaymentRailProvider, PdaxProvider, MockProvider
│  │  ├─ qrph/                 # EMVCo TLV parser + CRC-16
│  │  ├─ payments/             # quote, confirm, state machine
│  │  ├─ crypto/               # envelope encryption (AES-256-GCM)
│  │  ├─ storage/              # S3/MinIO client
│  │  └─ queue/                # BullMQ queues + job definitions
│  ├─ worker/                  # worker entrypoint (consumes queues)
│  ├─ lib/                     # shared utils, money, zod schemas
│  └─ components/              # UI components (themed)
├─ docker-compose.yml          # postgres + redis + minio (dev)
├─ .env.example
├─ Dockerfile                  # multi-stage (web) ; worker reuses image
├─ railway.json / railway.toml # services config
└─ package.json
```

---

## 4. Application best practices

- **Boundaries validated with Zod.** Every Route Handler / Server Action parses
  input with a Zod schema; never trust client data. Export inferred types.
- **Server-only secrets.** Mark secret modules `import "server-only"`. Stellar
  secrets, PDAX keys, encryption keys, and DB access **never** reach a Client
  Component or the network response.
- **Prisma client singleton** (avoid exhausting connections in dev/HMR). Use the
  Prisma 7 **driver adapter** (`@prisma/adapter-pg`) and a pooled connection
  string on Railway. Always specify `SHADOW_DATABASE_URL` for migrate drift.
- **Money math** only via `Decimal`; never `number`. Centralize XLM (7dp) / PHP
  (2dp) formatting and rounding in `lib/money.ts`.
- **Idempotency**: `Idempotency-Key` on money POSTs persisted to `IdempotencyKey`;
  worker jobs keyed by `paymentId:status`; safe to replay.
- **Async settlement**: API returns fast (`AUTHORIZED`), worker drives the state
  machine; UI polls `GET /api/payments/[id]` or subscribes via SSE.
- **External calls**: wrap with timeout + retry (exp backoff + jitter) + circuit
  breaker; treat all responses as untrusted and validate them too.
- **Pagination**: cursor-based for all lists.
- **Errors**: consistent envelope `{ error: { code, message, details? } }`; never
  leak stack traces, SQL, or provider internals to clients. Log full detail
  server-side with a `paymentId` correlation id.
- **Migrations**: every schema change is a checked-in migration; never edit an
  applied migration; `prisma migrate deploy` on release. Never `db push` in prod.
- **Feature flags**: gate USDC/USDT and any `PENDING_REVIEW` admin gate.
- **Accessibility/perf/responsive** per `BRAND.md`.

---

## 5. Authentication & sessions

- **Username + password only** (per scope). Hash with **argon2id** (sensible
  memory/time cost). Never store or log plaintext passwords.
- **Server-side sessions**: opaque random token (≥256-bit) set as an
  **HttpOnly, Secure, SameSite=Lax** cookie; store only the **hash** of the token
  in `Session`. Rotate on privilege change; expire + sliding renewal; allow
  logout (revoke) and "logout all".
- **Authorization** enforced in `proxy.ts` (route group → required role) **and**
  re-checked in each handler/action (never trust the middleware alone). Default
  deny.
- **CSRF**: since mutations use cookies, require the double-submit token or an
  `Origin`/`Sec-Fetch-Site` check on all unsafe methods. Server Actions: validate
  origin.
- **Rate limiting**: per-IP + per-account on `login`, `signup`, `password`,
  `quote`, `confirm` (Redis token bucket). Generic, non-enumerable auth errors.
- **Seeded admin**: created by `seed.ts` from `ADMIN_USERNAME`/`ADMIN_PASSWORD`
  env (argon2id, upsert). Force a password change on first admin login in prod;
  never commit real admin creds.
- **Account safety**: lockout/backoff after repeated failures; audit
  authentication events to `AuditLog`.

---

## 6. Security best practices (money + custody)

- **Custodial key protection (critical):** generate Stellar keypairs server-side;
  store secrets with **envelope encryption — AES-256-GCM** using a master key from
  the environment/KMS (`ENCRYPTION_MASTER_KEY` + `secretKeyVersion` for rotation).
  Decrypt only in-memory inside the signing service, only when submitting a tx.
  Never expose secrets to the client, logs, error messages, or the DB in plaintext.
- **Signing isolation:** signing lives in `server/stellar` only; the secret never
  crosses a module boundary into request/response paths.
- **PDAX credentials:** `PDAX_ACCESS_KEY`/`PDAX_SECRET`/`PDAX_TOTP_SECRET`
  server-only; sign each request (`Access-Key` + HMAC `Access-Signature`). PHP
  cash-out needs no OTP; crypto-out (refund path) does — derive TOTP server-side.
- **Secrets management:** all secrets via env (Railway variables); none in git.
  Provide `.env.example` with placeholders only. Rotate on exposure.
- **Transport & headers:** HTTPS only; set a strict **CSP** (no inline scripts
  beyond what's needed; the Material Symbols/Google Fonts origins allowlisted or
  self-hosted), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`
  (anti-clickjacking on the payment confirm screen), `Permissions-Policy`
  (allow `camera` only on the scan route).
- **Input/Output:** Zod validation in; encode/escape out (React handles most XSS,
  but sanitize any HTML and validate file uploads). Never build SQL by hand —
  Prisma parameterizes; avoid `$queryRawUnsafe`.
- **File uploads (QRPH/logo):** presigned uploads with a strict content-type +
  size limit; verify magic bytes server-side after upload; store under random
  keys; never trust client-provided filenames/paths; serve via signed URLs.
- **QRPH trust:** validate **CRC-16** and structure before acting; resolve to a
  registered merchant; reject unverified/foreign-currency codes.
- **PII protection:** encrypt merchant bank account numbers at rest; show only
  `last4`; redact in logs. Treat usernames + balances as sensitive.
- **Sensitive data in logs:** never log secrets, full account numbers, session
  tokens, or wallet secrets. Use structured logging with explicit field allowlists.
- **Idempotency + replay protection** on every money endpoint (also mitigates
  double-spend on double-click).
- **AuthZ on objects:** every payment/merchant/wallet read+write checks ownership
  (payer owns payment; merchant owns its records; admin override audited).
- **Dependency hygiene:** `pnpm audit`, lockfile committed, Dependabot/renovate,
  pin `packageManager`, no `postinstall` from untrusted packages.
- **Anti-automation on payments:** confirm requires fresh quote + reserved funds;
  rate-limit quote/confirm; one in-flight settlement per payment.
- **OWASP Top 10** review before release (access control, crypto failures,
  injection, SSRF on the QRPH/image fetch + webhook, security misconfig).
- **Webhook security:** verify PDAX callback signature / source allowlist; treat
  as untrusted; idempotent by external ref.

---

## 7. Stellar specifics

- Use `@stellar/stellar-sdk` `Horizon.Server`; configure network passphrase per
  env. Testnet + **friendbot** funding in dev; mainnet in prod.
- Amounts are **strings, ≤7 decimals**; convert via `Decimal`. Always set
  timebounds (`setTimeout`) and fetch base fee.
- Confirm tx success by polling the tx result (don't assume submit = success).
- Handle account-not-funded (base reserve) — surface a clear "deposit to activate".
- Persist a Horizon cursor for the deposit poller; make polling idempotent.

---

## 8. PDAX provider

- Implement `PaymentRailProvider`:
  ```ts
  interface PaymentRailProvider {
    getQuote(input: { sell: "XLM"; buy: "PHP"; phpAmount: Decimal }): Promise<Quote>;
    sellCryptoForPhp(input: { ref: string; xlmAmount: Decimal }): Promise<TradeResult>;
    getTradeStatus(tradeRef: string): Promise<TradeStatus>;
    cashOutPhpToBank(input: {
      ref: string;
      phpAmount: Decimal;
      bank: BankPayout;
    }): Promise<PayoutResult>;
    getPayoutStatus(payoutRef: string): Promise<PayoutStatus>;
  }
  ```
- `PdaxProvider`: real HMAC-signed calls to `PDAX_BASE_URL` (staging by default).
  Map PDAX `traded_currency`/`settlement_currency` semantics; fees on PHP.
- `MockProvider`: deterministic rate (configurable) + simulated async delays + a
  forced-failure switch for testing the `FAILED`/`REFUND` branches. Selected by
  `PAYMENT_RAIL=mock` for local dev, demos, and CI e2e.
- Never call PDAX from the browser or a Client Component.

---

## 9. Local development

**Docker Compose** provides Postgres, Redis, and MinIO:

```yaml
# docker-compose.yml (dev only)
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: heypay
      POSTGRES_PASSWORD: heypay
      POSTGRES_DB: heypay
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
  redis:
    image: redis:7
    ports: ["6379:6379"]
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: heypay
      MINIO_ROOT_PASSWORD: heypay-secret
    ports: ["9000:9000", "9001:9001"]
    volumes: ["miniodata:/data"]
volumes: { pgdata: {}, miniodata: {} }
```

Bootstrap:

```bash
pnpm install
docker compose up -d
cp .env.example .env                  # fill values
pnpm prisma migrate dev               # create schema
pnpm prisma db seed                   # seed admin (+ demo if SEED_DEMO=true)
pnpm dev                              # web (Next.js, Turbopack)
pnpm worker:dev                       # BullMQ worker (separate process)
```

- Default dev config: `PAYMENT_RAIL=mock`, `STELLAR_NETWORK=testnet`. The full
  happy path runs without real money or PDAX prod credentials.
- Create the MinIO bucket on startup (init script or app bootstrap).

---

## 10. `.env.example` (placeholders only — never commit real values)

```dotenv
# --- App ---
NODE_ENV=development
APP_URL=http://localhost:3000
SESSION_SECRET=replace-with-long-random-string
ENCRYPTION_MASTER_KEY=base64:replace-with-32-byte-key   # AES-256-GCM master key
ENCRYPTION_KEY_VERSION=1

# --- Database (Postgres) ---
DATABASE_URL=postgresql://heypay:heypay@localhost:5432/heypay?schema=public
SHADOW_DATABASE_URL=postgresql://heypay:heypay@localhost:5432/heypay_shadow?schema=public

# --- Redis / queue ---
REDIS_URL=redis://localhost:6379

# --- Seeded admin ---
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-me-strong
SEED_DEMO=true

# --- Stellar ---
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# --- Payment rail ---
PAYMENT_RAIL=mock                     # mock | pdax
PDAX_BASE_URL=https://services-stage.pdax.ph/api/exchange/v1
PDAX_ACCESS_KEY=
PDAX_SECRET=
PDAX_TOTP_SECRET=
PDAX_XLM_DEPOSIT_ADDRESS=             # HeyPay's PDAX XLM deposit address (mainnet)

# --- Object storage (MinIO dev / Railway prod, S3-compatible) ---
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=heypay-uploads
S3_ACCESS_KEY=heypay
S3_SECRET_KEY=heypay-secret
S3_FORCE_PATH_STYLE=true              # true for MinIO
```

---

## 11. Deployment (Railway)

- Two services from one repo: **`web`** (`pnpm build` → `pnpm start`) and
  **`worker`** (`pnpm worker:start`). Shared env group.
- Add **Postgres** and **Redis** plugins → inject `DATABASE_URL`, `REDIS_URL`.
  Use a **pooled** connection string for the web service.
- Object storage: Railway bucket (or volume) → set `S3_*` (path-style off for a
  real S3 endpoint). Create the bucket once.
- **Release command:** `pnpm prisma migrate deploy` (run before traffic shifts).
  Run `prisma db seed` once for the admin in prod (or a guarded one-off).
- Set all secrets as Railway variables (never in the repo). `NODE_ENV=production`,
  `STELLAR_NETWORK=mainnet`, `PAYMENT_RAIL=pdax`, real `PDAX_*` from
  `institutions.pdax.ph`.
- Health checks hit `/api/admin/health` (or a public `/api/health`).
- Multi-stage Dockerfile: install with pnpm (frozen lockfile), `prisma generate`,
  build Next, run as non-root, minimal runtime image.

---

## 12. Quality gates (must pass before "done")

- [ ] `pnpm typecheck` (no `any` at boundaries), `pnpm lint`, `pnpm format:check` clean.
- [ ] `pnpm audit --prod` clean; all deps on current stable; lockfile committed.
- [ ] Unit tests: QRPH TLV+CRC parser, quote/fee math, state-machine transitions,
      envelope encryption round-trip.
- [ ] Integration tests: API handlers against a throwaway Postgres.
- [ ] e2e (Playwright, `PAYMENT_RAIL=mock`, Stellar testnet): payer signup →
      prefund → scan → confirm → `SETTLED`; merchant onboarding → go-live →
      settlement appears; admin can view + retry a forced failure.
- [ ] No secret/PII in logs; security headers present; CSRF + rate limits active.
- [ ] `docker compose up` + documented bootstrap works from a clean checkout.
- [ ] Migrations apply cleanly; seed creates the admin idempotently.

---

## 13. Conventions

- Commits: Conventional Commits. PRs small and focused.
- Naming: `camelCase` vars, `PascalCase` types/components, `SCREAMING_SNAKE` env.
- All amounts in code are `Decimal`; format only at the view layer.
- Co-locate Zod schemas with their handlers; export inferred types.
- Keep the `PaymentRailProvider` and `WalletService` interfaces stable so USDC/
  USDT and alternative rails slot in without touching the state machine.
- Document any deviation from `SPEC.md` in the PR description with rationale.
