# Phase 1: Foundation & Infrastructure — HeyPay

> Consumes Global Constraints + Locked Shared Contracts from `2026-06-28-heypay-00-overview.md`. Execute tasks in order.

**Goal:** Stand up a bootable Next.js 16 App Router project (TypeScript strict, pnpm, Node 22) with the Tailwind v4 CSS-first theme, local infra (Postgres/Redis/MinIO via docker-compose), the complete Prisma 7 data model + first migration + idempotent seed, the Prisma/Redis singletons, and the three foundational shared libs (`money.ts`, `errors.ts`, `http.ts`) with green unit tests.

**Depends on: none**

**Deliverable:** `pnpm dev` boots the themed app; `docker compose up -d` + `pnpm prisma migrate dev` + `pnpm prisma db seed` create the schema and seed the admin; `pnpm vitest run` is green for money/errors/http.

---

## Task 1 — Workspace scaffold & tooling config

**Files**

- Create: `package.json`, `pnpm-workspace.yaml` (optional, skipped), `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `.npmrc`

**Interfaces**

- Consumes: AGENT §1/§2 tech stack + pinned versions; Global Constraints (Node 22, pnpm pinned, strict TS).
- Produces: pnpm project with scripts `dev`, `build`, `start`, `worker:dev`, `worker:start`, `typecheck`, `lint`, `format:check`, `format`, `test`.

**Steps**

- [ ] Create `.npmrc`:

```ini
auto-install-peers=true
strict-peer-dependencies=false
```

- [ ] Create `package.json` (versions reflect the current stable lines from AGENT §2; they are re-pinned to newest stable in the next step):

```json
{
  "name": "heypay",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.12.1",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "worker:dev": "tsx watch src/worker/index.ts",
    "worker:start": "tsx src/worker/index.ts",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run"
  },
  "dependencies": {
    "@prisma/adapter-pg": "^7.0.0",
    "@prisma/client": "^7.0.0",
    "decimal.js": "^10.4.3",
    "ioredis": "^5.4.2",
    "next": "^16.2.0",
    "pg": "^8.13.1",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "server-only": "^0.0.1",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@next/eslint-plugin-next": "^16.2.0",
    "@eslint/js": "^9.17.0",
    "@types/node": "^22.10.2",
    "@types/pg": "^8.11.10",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "argon2": "^0.41.1",
    "dotenv": "^16.4.7",
    "eslint": "^9.17.0",
    "prettier": "^3.4.2",
    "prisma": "^7.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "typescript-eslint": "^8.18.1",
    "vite-tsconfig-paths": "^5.1.4",
    "vitest": "^2.1.8"
  }
}
```

- [ ] Pin to newest stable and write the lockfile (AGENT prime directive #1):

```bash
corepack enable && corepack prepare pnpm@latest --activate
pnpm install
pnpm up --latest next react react-dom prisma @prisma/client @prisma/adapter-pg pg tailwindcss @tailwindcss/postcss zod ioredis argon2 decimal.js vitest typescript
pnpm audit --prod
```

Expected: install completes; `pnpm-lock.yaml` is written; `pnpm audit --prod` prints `No known vulnerabilities found` (resolve any that appear before continuing). Re-sync the version strings in `package.json` to whatever `pnpm up --latest` resolved.

- [ ] Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "jsx": "preserve",
    "incremental": true,
    "skipLibCheck": true,
    "allowJs": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "src/generated"]
}
```

- [ ] Create `next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/Node-only deps must not be bundled into server components output.
  serverExternalPackages: ["argon2", "@prisma/adapter-pg", "pg", "ioredis"],
};

export default nextConfig;
```

- [ ] Create `eslint.config.mjs` (flat config):

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/generated/**",
      "prisma/migrations/**",
      "pnpm-lock.yaml",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
```

- [ ] Create `.prettierrc.json`:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] Create `.prettierignore`:

```gitignore
node_modules
.next
src/generated
prisma/migrations
pnpm-lock.yaml
```

- [ ] Create `.gitignore`:

```gitignore
# dependencies
node_modules

# next
.next
out
next-env.d.ts

# env
.env
.env.local
.env*.local

# prisma generated client
src/generated

# build / runtime
dist
*.log
coverage

# os
.DS_Store
```

- [ ] Verify the toolchain installs cleanly:

```bash
pnpm install
```

Expected: `Done` with no errors; `pnpm-lock.yaml` present.

- [ ] Commit: `chore: scaffold pnpm + Next.js 16 workspace with strict TS, ESLint flat config, Prettier`

---

## Task 2 — Tailwind v4 CSS-first theme, fonts, and root layout

**Files**

- Create: `postcss.config.mjs`, `src/app/globals.css`, `src/app/layout.tsx`, `src/app/page.tsx`

**Interfaces**

- Consumes: BRAND §9 `@theme` (verbatim), §3 fonts (Lexend/Inter), §6 Material Symbols, Global Constraints theming rules.
- Produces: token utilities (`bg-primary`, `text-display-lg`, `rounded-xl`, `p-stack-lg`, `.glass`, `.tonal-card`, `.icon-filled`) + bootable root layout.

**Steps**

- [ ] Create `postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

- [ ] Create `src/app/globals.css` — the FULL BRAND §9 block copied verbatim, plus a base layer (background/body font), Material Symbols variation defaults, and the `.icon-filled` helper:

```css
@import "tailwindcss";

@theme {
  /* ---- Brand ---- */
  --color-primary: #00bcd4;
  --color-on-primary: #ffffff;
  --color-primary-container: #b2ebf2;
  --color-on-primary-container: #002024;
  --color-secondary: #ff9800;
  --color-on-secondary: #ffffff;
  --color-secondary-container: #ffe0b2;
  --color-on-secondary-container: #e65100;
  --color-accent: #ff9800; /* alias of secondary */
  --color-tertiary: #0097a7;
  --color-on-tertiary: #ffffff;

  /* ---- Surfaces ---- */
  --color-background: #fcf9f8;
  --color-on-background: #1d1b1a;
  --color-surface: #fcf9f8;
  --color-on-surface: #1d1b1a;
  --color-surface-variant: #eee8e5;
  --color-on-surface-variant: #4e4643;
  --color-surface-container-lowest: #ffffff;
  --color-surface-container-low: #f6f3f2;
  --color-surface-container: #f0edea;
  --color-surface-container-high: #ebe7e4;
  --color-surface-container-highest: #e5e1de;
  --color-outline: #807673;
  --color-outline-variant: #d2c5c1;

  /* ---- Status ---- */
  --color-error: #ba1a1a;
  --color-on-error: #ffffff;

  /* ---- Fonts ---- */
  --font-display: "Lexend", system-ui, sans-serif;
  --font-headline: "Lexend", system-ui, sans-serif;
  --font-label: "Lexend", system-ui, sans-serif;
  --font-body: "Inter", system-ui, sans-serif;
  --font-mono: "Inter", ui-monospace, monospace;

  /* ---- Type scale (text-<name>) ---- */
  --text-display-lg: 48px;
  --text-display-lg--line-height: 56px;
  --text-display-lg--letter-spacing: -0.02em;
  --text-display-lg--font-weight: 700;
  --text-headline-lg: 32px;
  --text-headline-lg--line-height: 40px;
  --text-headline-lg--font-weight: 600;
  --text-headline-lg-mobile: 24px;
  --text-headline-lg-mobile--line-height: 32px;
  --text-headline-lg-mobile--font-weight: 600;
  --text-headline-md: 24px;
  --text-headline-md--line-height: 32px;
  --text-headline-md--font-weight: 500;
  --text-body-lg: 18px;
  --text-body-lg--line-height: 28px;
  --text-body-md: 16px;
  --text-body-md--line-height: 24px;
  --text-body-sm: 14px;
  --text-body-sm--line-height: 20px;
  --text-label-md: 12px;
  --text-label-md--line-height: 16px;
  --text-label-md--letter-spacing: 0.05em;
  --text-label-md--font-weight: 600;
  --text-mono-data: 14px;
  --text-mono-data--line-height: 20px;
  --text-mono-data--letter-spacing: -0.01em;
  --text-mono-data--font-weight: 500;

  /* ---- Radius (rounded-<name>) ---- */
  --radius-DEFAULT: 0.5rem;
  --radius-lg: 0.5rem;
  --radius-xl: 1rem;
  --radius-full: 9999px;

  /* ---- Spacing (p-/m-/gap- <name>) ---- */
  --spacing-unit: 4px;
  --spacing-stack-sm: 8px;
  --spacing-stack-md: 16px;
  --spacing-gutter: 16px;
  --spacing-stack-lg: 24px;
  --spacing-margin-mobile: 20px;
  --spacing-margin-desktop: 40px;
}

/* Base surface + icon defaults */
@layer base {
  body {
    background: var(--color-background);
    color: var(--color-on-background);
    font-family: var(--font-body);
  }
  .material-symbols-outlined {
    font-variation-settings:
      "FILL" 0,
      "wght" 400,
      "GRAD" 0,
      "opsz" 24;
  }
  .icon-filled {
    font-variation-settings:
      "FILL" 1,
      "wght" 400,
      "GRAD" 0,
      "opsz" 24;
  }
}

/* Reusable surface utilities */
@layer components {
  .glass {
    background: color-mix(in srgb, var(--color-background) 70%, transparent);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }
  .tonal-card {
    background: var(--color-surface-container-lowest);
    box-shadow: 0 8px 24px rgba(0, 188, 212, 0.08);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
}
```

- [ ] Create `src/app/layout.tsx` (loads Lexend + Inter + Material Symbols via Google Fonts links so the literal family names in `@theme` resolve; applies base background + body font):

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HeyPay",
  description: "Pay any QRPH merchant in the Philippines with your Stellar (XLM) balance.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lexend:wght@400;500;600;700&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0"
        />
      </head>
      <body className="min-h-dvh bg-background font-body text-on-background antialiased">
        {children}
      </body>
    </html>
  );
}
```

- [ ] Create `src/app/page.tsx` (minimal themed landing so the app boots and proves token utilities render; full marketing/redirect lands in Phase 6):

```tsx
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center gap-stack-lg px-margin-mobile text-center">
      <span className="material-symbols-outlined icon-filled text-5xl text-primary">
        account_balance_wallet
      </span>
      <h1 className="font-display text-headline-lg text-primary">HeyPay</h1>
      <p className="font-body text-body-md text-on-surface-variant">
        Pay any QRPH merchant with your Stellar balance.
      </p>
      <p className="tonal-card rounded-xl px-stack-lg py-stack-md font-mono text-mono-data text-on-surface">
        Foundation ready.
      </p>
    </main>
  );
}
```

- [ ] Verify a production build succeeds (static page, no DB needed):

```bash
pnpm build
```

Expected: `✓ Compiled successfully`; route `/` listed as a static page; exit 0.

- [ ] Commit: `feat: add Tailwind v4 theme, fonts, and themed root layout`

---

## Task 3 — Local infra: docker-compose + .env.example

**Files**

- Create: `docker-compose.yml`, `.env.example`

**Interfaces**

- Consumes: AGENT §9 (docker-compose, verbatim), AGENT §10 / SPEC §11 (env skeleton, placeholders only).
- Produces: Postgres 17 + Redis 7 + MinIO locally; documented env contract.

**Steps**

- [ ] Create `docker-compose.yml` (verbatim per AGENT §9):

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

- [ ] Create `.env.example` (verbatim per AGENT §10; placeholders only — never commit real values):

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

- [ ] Validate the compose file and bring infra up:

```bash
docker compose config >/dev/null && echo "compose-ok"
docker compose up -d
docker compose ps
```

Expected: prints `compose-ok`; `postgres`, `redis`, `minio` show state `running`/`Up`.

- [ ] Create the local `.env` and the shadow DB needed by `migrate dev`:

```bash
cp .env.example .env
docker compose exec -T postgres psql -U heypay -d heypay -c "CREATE DATABASE heypay_shadow;" || true
```

Expected: `.env` created; `CREATE DATABASE` (or an "already exists" notice — both fine).

- [ ] Commit: `chore: add docker-compose (postgres/redis/minio) and .env.example skeleton`

---

## Task 4 — Prisma 7: schema, config, client/redis singletons, first migration

**Files**

- Create: `prisma.config.ts`, `prisma/schema.prisma`, `src/server/db.ts`, `src/server/redis.ts`
- Generates: `prisma/migrations/<ts>_init/`, `src/generated/prisma/**`

**Interfaces**

- Consumes: SPEC §4 data model (verbatim), AGENT §3 structure, Global Constraints (driver adapter, shadow DB, migrations checked in).
- Produces: `prisma` singleton (`@/server/db`), `redis` singleton (`@/server/redis`), generated `@/generated/prisma` (with `Role`, `Merchant`, `PrismaClient`, all enums/models).

**Steps**

- [ ] Create `prisma.config.ts` (Prisma 7 config; loads env, wires the seed command consumed in Task 5):

```ts
import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
});
```

- [ ] Create `prisma/schema.prisma` — the COMPLETE SPEC §4 model verbatim, with `provider = "prisma-client"`, the `src/generated/prisma` output, and `shadowDatabaseUrl` added per Global Constraints:

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client"          // Prisma 7 Rust-free generator
  output   = "../src/generated/prisma"
}

datasource db {
  provider          = "postgresql"
  url               = env("DATABASE_URL")
  shadowDatabaseUrl = env("SHADOW_DATABASE_URL")
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

- [ ] Create `src/server/db.ts` (Prisma 7 singleton via `@prisma/adapter-pg`; server-only):

```ts
import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const adapter = new PrismaPg({ connectionString });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] Create `src/server/redis.ts` (ioredis singleton; `maxRetriesPerRequest: null` required by BullMQ in later phases; server-only):

```ts
import "server-only";
import Redis from "ioredis";

const url = process.env.REDIS_URL ?? "redis://localhost:6379";

const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redis: Redis =
  globalForRedis.redis ??
  new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;
```

- [ ] Create the first migration and generate the client (docker infra from Task 3 must be up):

```bash
pnpm prisma migrate dev --name init
```

Expected: a new folder `prisma/migrations/<timestamp>_init/migration.sql` is created; output ends with `Your database is now in sync with your schema.` and `Generated Prisma Client ... to ./src/generated/prisma`.

- [ ] Confirm the client and enums generated:

```bash
pnpm exec node -e "import('./src/generated/prisma/index.js').then(m=>console.log(Object.keys(m.Role).join(',')))"
```

Expected: `ADMIN,PAYER,MERCHANT`.

- [ ] Verify types compile against the generated client:

```bash
pnpm typecheck
```

Expected: exit 0, no errors.

- [ ] Commit: `feat: add Prisma 7 schema, driver-adapter client + redis singletons, init migration`

---

## Task 5 — Idempotent seed (admin + optional demo)

**Files**

- Create: `prisma/seed.ts`

**Interfaces**

- Consumes: SPEC §4 seed spec, AGENT §5 (argon2id seeded admin), `prisma.config.ts` seed wiring (Task 4), env `ADMIN_USERNAME`/`ADMIN_PASSWORD`/`SEED_DEMO`.
- Produces: `pnpm prisma db seed` upserts the admin idempotently; demo payer + demo merchant gated by `SEED_DEMO=true`.

> Note: the demo payer's testnet custodial wallet (friendbot funding) and the demo merchant's envelope-encrypted account number depend on Phase 3 helpers (`walletService`, `encryptSecret`). They are stubbed here behind the `SEED_DEMO` gate so `pnpm prisma db seed` succeeds with only the admin. Phase 3 will replace the stub values.

**Steps**

- [ ] Create `prisma/seed.ts` (uses its own adapter-backed client; an inline minimal argon2id hash so the seed runs without Phase 2's password helper):

```ts
import "dotenv/config";
import * as argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Role } from "../src/generated/prisma";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// Minimal inline argon2id hash so the seed is self-contained (Phase 2 centralizes this).
async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

async function seedAdmin(): Promise<void> {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD must be set to seed the admin.");
  }
  const passwordHash = await hashPassword(password);
  const admin = await prisma.user.upsert({
    where: { username },
    update: { role: Role.ADMIN, isActive: true },
    create: { username, passwordHash, role: Role.ADMIN },
  });
  console.log(`[seed] admin ready: ${admin.username}`);
}

async function seedDemo(): Promise<void> {
  if (process.env.SEED_DEMO !== "true") {
    console.log("[seed] SEED_DEMO != 'true'; skipping demo data.");
    return;
  }

  // Demo payer. Custodial testnet wallet + friendbot funding is wired in Phase 3.
  const payerHash = await hashPassword("demo-payer-pass");
  const payer = await prisma.user.upsert({
    where: { username: "demo-payer" },
    update: {},
    create: { username: "demo-payer", passwordHash: payerHash, role: Role.PAYER },
  });
  console.log(
    `[seed] demo payer ready: ${payer.username} (custodial wallet stubbed until Phase 3)`,
  );

  // Demo merchant with a sample decoded QRPH + masked test bank account.
  // accountNumber is a placeholder; Phase 3 replaces it with an envelope-encrypted value.
  const merchantHash = await hashPassword("demo-merchant-pass");
  const merchantUser = await prisma.user.upsert({
    where: { username: "demo-merchant" },
    update: {},
    create: { username: "demo-merchant", passwordHash: merchantHash, role: Role.MERCHANT },
  });
  await prisma.merchant.upsert({
    where: { userId: merchantUser.id },
    update: {},
    create: {
      userId: merchantUser.id,
      businessName: "Demo Sari-Sari Store",
      status: "ACTIVE",
      qrphRaw:
        "00020101021128120008ph.qrph0104DEMO5204000053036085802PH5914DEMO SARI-SARI6006MANILA6304ABCD",
      qrphMerchantName: "DEMO SARI-SARI",
      qrphMerchantCity: "MANILA",
      qrphMerchantId: "DEMO-MID-0001",
      qrphCountry: "PH",
      qrphCurrency: "608",
      settlementBankCode: "BPI",
      settlementBankName: "Bank of the Philippine Islands",
      accountName: "Demo Merchant Inc.",
      accountNumber: "stub:encrypt-in-phase3",
      accountNumberLast4: "6789",
    },
  });
  console.log(`[seed] demo merchant ready: ${merchantUser.username}`);
}

async function main(): Promise<void> {
  await seedAdmin();
  await seedDemo();
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] Run the seed (admin + demo, since `.env` has `SEED_DEMO=true`):

```bash
pnpm prisma db seed
```

Expected: prints `[seed] admin ready: admin`, `[seed] demo payer ready: demo-payer ...`, `[seed] demo merchant ready: demo-merchant`; exit 0.

- [ ] Verify idempotency (re-run produces no duplicates):

```bash
pnpm prisma db seed
docker compose exec -T postgres psql -U heypay -d heypay -t -c "SELECT count(*) FROM \"User\" WHERE username='admin';"
```

Expected: seed succeeds again; the count query prints `1`.

- [ ] Verify the admin-only path works (gate off):

```bash
SEED_DEMO=false pnpm prisma db seed
```

Expected: prints `[seed] admin ready: admin` then `[seed] SEED_DEMO != 'true'; skipping demo data.`; exit 0.

- [ ] Commit: `feat: add idempotent prisma seed (admin upsert + gated demo payer/merchant)`

---

## Task 6 — `vitest.config.ts` + `src/lib/money.ts` (TDD)

**Files**

- Create: `vitest.config.ts`, `src/lib/money.ts`
- Test: `src/lib/money.test.ts`

**Interfaces**

- Consumes: Locked Money contract (overview).
- Produces (verbatim signatures): `dec`, `formatXlm`, `formatPhp`, `displayPhp`, `displayXlm`, `phpToXlm`, `availableXlm`, re-exported `Decimal`.

**Steps**

- [ ] Create `vitest.config.ts` (node env, `@/` alias via tsconfig paths):

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    globals: false,
  },
});
```

- [ ] Write the failing test `src/lib/money.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  dec,
  formatXlm,
  formatPhp,
  displayPhp,
  displayXlm,
  phpToXlm,
  availableXlm,
  Decimal,
} from "./money";

describe("dec", () => {
  it("constructs from string, number, and Decimal", () => {
    expect(dec("1.5").toString()).toBe("1.5");
    expect(dec(2).toString()).toBe("2");
    expect(dec(new Decimal("3")).toString()).toBe("3");
  });
  it("throws on NaN and Infinity", () => {
    expect(() => dec(NaN)).toThrow();
    expect(() => dec(Infinity)).toThrow();
  });
});

describe("formatXlm", () => {
  it("always renders exactly 7 decimal places", () => {
    expect(formatXlm(dec("12.5"))).toBe("12.5000000");
    expect(formatXlm(dec("0"))).toBe("0.0000000");
  });
  it("rounds half-up at the 7th decimal", () => {
    expect(formatXlm(dec("1.00000005"))).toBe("1.0000001");
  });
});

describe("formatPhp", () => {
  it("always renders exactly 2 decimal places, half-up", () => {
    expect(formatPhp(dec("1234.5"))).toBe("1234.50");
    expect(formatPhp(dec("1.005"))).toBe("1.01");
  });
});

describe("displayPhp / displayXlm", () => {
  it("groups thousands with the peso sign at 2dp", () => {
    expect(displayPhp(dec("1234.5"))).toBe("₱1,234.50");
    expect(displayPhp(dec("1000000"))).toBe("₱1,000,000.00");
  });
  it("suffixes XLM with the unit at 7dp", () => {
    expect(displayXlm(dec("12.5"))).toBe("12.5000000 XLM");
  });
});

describe("phpToXlm", () => {
  it("rounds UP at 7dp so the payer always covers the PHP amount", () => {
    expect(phpToXlm(dec("100"), dec("7")).toString()).toBe("14.2857143");
    expect(phpToXlm(dec("1"), dec("3")).toString()).toBe("0.3333334");
  });
  it("throws on a non-positive rate", () => {
    expect(() => phpToXlm(dec("1"), dec("0"))).toThrow();
  });
});

describe("availableXlm", () => {
  it("subtracts reserved from cached", () => {
    expect(availableXlm(dec("10"), dec("3.5")).toString()).toBe("6.5");
  });
});
```

- [ ] Run the test, expect FAIL (module does not exist yet):

```bash
pnpm vitest run src/lib/money.test.ts
```

Expected: FAIL — `Error: Failed to load url ./money` / "Cannot find module", 0 passing.

- [ ] Implement `src/lib/money.ts` (full code, no placeholders):

```ts
import { Decimal } from "decimal.js";

// Global precision headroom; rounding is applied explicitly per-format.
Decimal.set({ precision: 40 });

export { Decimal };

/** Construct a Decimal from any source; throws on NaN/Infinity. */
export function dec(value: string | number | Decimal): Decimal {
  const d = value instanceof Decimal ? value : new Decimal(value);
  if (!d.isFinite()) throw new Error(`Invalid monetary value: ${String(value)}`);
  return d;
}

/** Format XLM with exactly 7 dp (string), half-up. e.g. "12.5000000" */
export function formatXlm(value: Decimal): string {
  return dec(value).toDecimalPlaces(7, Decimal.ROUND_HALF_UP).toFixed(7);
}

/** Format PHP with exactly 2 dp (string), half-up. e.g. "1234.50" */
export function formatPhp(value: Decimal): string {
  return dec(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** Display helper: "₱1,234.50" (grouped, 2dp). */
export function displayPhp(value: Decimal): string {
  const fixed = formatPhp(value);
  const negative = fixed.startsWith("-");
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [intPart, frac] = unsigned.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}₱${grouped}.${frac}`;
}

/** Display helper: "12.5000000 XLM" (7dp). */
export function displayXlm(value: Decimal): string {
  return `${formatXlm(value)} XLM`;
}

/** Quote math: phpAmount / rate -> XLM needed (7dp, ROUND_UP so payer always covers). */
export function phpToXlm(phpAmount: Decimal, rate: Decimal): Decimal {
  const php = dec(phpAmount);
  const r = dec(rate);
  if (r.lte(0)) throw new Error("Rate must be a positive number");
  return php.div(r).toDecimalPlaces(7, Decimal.ROUND_UP);
}

/** availableXlm = cachedXlmBalance - reservedXlm */
export function availableXlm(cached: Decimal, reserved: Decimal): Decimal {
  return dec(cached).minus(dec(reserved));
}
```

- [ ] Run the test, expect PASS:

```bash
pnpm vitest run src/lib/money.test.ts
```

Expected: PASS — all describe blocks green (e.g. `Test Files 1 passed`, `Tests 9 passed`).

- [ ] Commit: `feat: add money.ts (Decimal helpers, phpToXlm ROUND_UP) with vitest config and tests`

---

## Task 7 — `src/lib/errors.ts` (TDD)

**Files**

- Create: `src/lib/errors.ts`
- Test: `src/lib/errors.test.ts`

**Interfaces**

- Consumes: Locked Errors contract (overview).
- Produces (verbatim): `ErrorEnvelope`, `AppError`, and constructors `badRequest`/`unauthorized`/`forbidden`/`notFound`/`conflict`/`tooManyRequests`/`serverError`. Adds an additive `AppError.toEnvelope()` helper (does not change the contract signature).

**Steps**

- [ ] Write the failing test `src/lib/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  AppError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooManyRequests,
  serverError,
} from "./errors";

describe("AppError", () => {
  it("carries code/message/status/details and is an Error", () => {
    const e = new AppError("X_CODE", "boom", 418, { a: 1 });
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("X_CODE");
    expect(e.message).toBe("boom");
    expect(e.status).toBe(418);
    expect(e.details).toEqual({ a: 1 });
  });
  it("renders an ErrorEnvelope, with and without details", () => {
    expect(new AppError("X", "m", 400, { f: "x" }).toEnvelope()).toEqual({
      error: { code: "X", message: "m", details: { f: "x" } },
    });
    expect(new AppError("X", "m", 400).toEnvelope()).toEqual({
      error: { code: "X", message: "m" },
    });
  });
});

describe("convenience constructors map to correct HTTP statuses", () => {
  it("returns AppError instances with the right status", () => {
    expect(badRequest("b")).toBeInstanceOf(AppError);
    expect(badRequest("b").status).toBe(400);
    expect(unauthorized().status).toBe(401);
    expect(forbidden().status).toBe(403);
    expect(notFound().status).toBe(404);
    expect(conflict("c").status).toBe(409);
    expect(tooManyRequests().status).toBe(429);
    expect(serverError().status).toBe(500);
  });
  it("badRequest and conflict carry details", () => {
    expect(badRequest("b", { field: "x" }).details).toEqual({ field: "x" });
    expect(conflict("c", { id: "1" }).details).toEqual({ id: "1" });
  });
});
```

- [ ] Run the test, expect FAIL (module does not exist yet):

```bash
pnpm vitest run src/lib/errors.test.ts
```

Expected: FAIL — cannot resolve `./errors`, 0 passing.

- [ ] Implement `src/lib/errors.ts` (full code):

```ts
export type ErrorEnvelope = { error: { code: string; message: string; details?: unknown } };

/** Thrown inside handlers; caught by the API wrapper and rendered as ErrorEnvelope. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export const badRequest = (msg: string, details?: unknown): AppError =>
  new AppError("BAD_REQUEST", msg, 400, details);

export const unauthorized = (msg = "Authentication required."): AppError =>
  new AppError("UNAUTHORIZED", msg, 401);

export const forbidden = (msg = "You do not have access to this resource."): AppError =>
  new AppError("FORBIDDEN", msg, 403);

export const notFound = (msg = "Resource not found."): AppError =>
  new AppError("NOT_FOUND", msg, 404);

export const conflict = (msg: string, details?: unknown): AppError =>
  new AppError("CONFLICT", msg, 409, details);

export const tooManyRequests = (msg = "Too many requests. Please slow down."): AppError =>
  new AppError("TOO_MANY_REQUESTS", msg, 429);

export const serverError = (msg = "Something went wrong."): AppError =>
  new AppError("SERVER_ERROR", msg, 500);
```

- [ ] Run the test, expect PASS:

```bash
pnpm vitest run src/lib/errors.test.ts
```

Expected: PASS — `Tests ... passed`.

- [ ] Commit: `feat: add errors.ts (AppError + convenience constructors + envelope) with tests`

---

## Task 8 — `src/lib/http.ts` (TDD)

**Files**

- Create: `src/lib/http.ts`
- Test: `src/lib/http.test.ts`

**Interfaces**

- Consumes: Locked HTTP contract (overview); `AppError`/`badRequest`/`serverError` from `./errors`; `Role` type from `@/generated/prisma` (type-only, erased at runtime).
- Produces (verbatim): `Handler`, `HandlerContext`, `route`, `json`, `parseBody`, `parseQuery`.

**Steps**

- [ ] Write the failing test `src/lib/http.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { route, json, parseBody, parseQuery } from "./http";
import { notFound } from "./errors";

function req(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new Request(url, init));
}

const jsonInit = (body: string): RequestInit => ({
  method: "POST",
  body,
  headers: { "content-type": "application/json" },
});

describe("json", () => {
  it("returns a NextResponse with status + body", async () => {
    const res = json({ ok: true }, 201);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("parseBody", () => {
  const schema = z.object({ amount: z.number() });
  it("returns parsed data on a valid body", async () => {
    const r = req("http://localhost/api/x", jsonInit(JSON.stringify({ amount: 5 })));
    await expect(parseBody(r, schema)).resolves.toEqual({ amount: 5 });
  });
  it("throws badRequest (400) on a schema-invalid body", async () => {
    const r = req("http://localhost/api/x", jsonInit(JSON.stringify({ amount: "no" })));
    await expect(parseBody(r, schema)).rejects.toMatchObject({ code: "BAD_REQUEST", status: 400 });
  });
  it("throws badRequest (400) on a non-JSON body", async () => {
    const r = req("http://localhost/api/x", jsonInit("not-json"));
    await expect(parseBody(r, schema)).rejects.toMatchObject({ status: 400 });
  });
});

describe("parseQuery", () => {
  const schema = z.object({ limit: z.string() });
  it("parses present query params", () => {
    expect(parseQuery(req("http://localhost/api/x?limit=10"), schema)).toEqual({ limit: "10" });
  });
  it("throws on missing required params", () => {
    expect(() => parseQuery(req("http://localhost/api/x"), schema)).toThrow();
  });
});

describe("route", () => {
  it("renders a thrown AppError as the error envelope with its status", async () => {
    const handler = route(async () => {
      throw notFound("nope");
    });
    const res = await handler(req("http://localhost/api/x"), { params: Promise.resolve({}) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "nope" } });
  });
  it("renders a ZodError as a 400 BAD_REQUEST envelope", async () => {
    const handler = route(async (r) => {
      await parseBody(r, z.object({ a: z.number() }));
      return json({});
    });
    const res = await handler(req("http://localhost/api/x", jsonInit("{}")), {
      params: Promise.resolve({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });
  it("passes awaited route params to the handler context", async () => {
    const handler = route(async (_r, ctx) => json({ id: ctx.params.id }));
    const res = await handler(req("http://localhost/api/x"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(await res.json()).toEqual({ id: "abc" });
  });
  it("masks unexpected errors as a 500 SERVER_ERROR envelope", async () => {
    const handler = route(async () => {
      throw new Error("boom internal");
    });
    const res = await handler(req("http://localhost/api/x"), { params: Promise.resolve({}) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("SERVER_ERROR");
    expect(JSON.stringify(body)).not.toContain("boom internal");
  });
});
```

- [ ] Run the test, expect FAIL (module does not exist yet):

```bash
pnpm vitest run src/lib/http.test.ts
```

Expected: FAIL — cannot resolve `./http`, 0 passing.

- [ ] Implement `src/lib/http.ts` (full code):

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Role } from "@/generated/prisma";
import { AppError, badRequest, serverError, type ErrorEnvelope } from "./errors";

export type HandlerContext = {
  params: Record<string, string>;
  userId: string | null;
  role: Role | null;
};

export type Handler = (req: NextRequest, ctx: HandlerContext) => Promise<NextResponse>;

/** JSON success helper. */
export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof z.ZodError) return badRequest("Validation failed.", err.flatten());
  return serverError();
}

/**
 * Wraps a Route Handler: resolves Next 16 async params, builds the context,
 * catches AppError/ZodError -> ErrorEnvelope + status, logs full detail server-side.
 * (Auth population of userId/role is layered in by Phase 2.)
 */
export function route(
  handler: Handler,
): (req: NextRequest, raw: { params: Promise<Record<string, string>> }) => Promise<NextResponse> {
  return async (req, raw) => {
    try {
      const params = raw?.params ? await raw.params : {};
      const ctx: HandlerContext = { params: params ?? {}, userId: null, role: null };
      return await handler(req, ctx);
    } catch (err) {
      const appErr = toAppError(err);
      if (appErr.status >= 500) {
        // Full detail stays server-side; clients only see the envelope.
        console.error("[route]", appErr.code, appErr.message, err);
      }
      const body: ErrorEnvelope = appErr.toEnvelope();
      return NextResponse.json(body, { status: appErr.status });
    }
  };
}

/** Parse + validate a JSON body with a Zod schema; throws badRequest on failure. */
export async function parseBody<S extends z.ZodTypeAny>(
  req: NextRequest,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw badRequest("Validation failed.", result.error.flatten());
  return result.data;
}

/** Parse + validate query params with a Zod schema; throws badRequest on failure. */
export function parseQuery<S extends z.ZodTypeAny>(req: NextRequest, schema: S): z.infer<S> {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const result = schema.safeParse(params);
  if (!result.success) throw badRequest("Invalid query parameters.", result.error.flatten());
  return result.data;
}
```

- [ ] Run the test, expect PASS:

```bash
pnpm vitest run src/lib/http.test.ts
```

Expected: PASS — all `route`/`parseBody`/`parseQuery`/`json` cases green.

- [ ] Run the full Phase-1 quality gates:

```bash
pnpm vitest run && pnpm typecheck && pnpm lint && pnpm format:check
```

Expected: vitest all green; typecheck exit 0; lint exit 0; `format:check` reports all files formatted (run `pnpm format` first if needed, then re-check).

- [ ] Commit: `feat: add http.ts route wrapper + parseBody/parseQuery/json with tests`

---

## Self-Review

Coverage of every Phase-1 spec item to a task:

- **Project scaffold (Next 16.2.x + React 19.2.x + TS strict + pnpm, `packageManager` pinned, Node 22, ESLint flat + Prettier, all required scripts)** → Task 1. Scripts present: `dev`, `build`, `start`, `worker:dev`, `worker:start`, `typecheck`, `lint`, `format`, `format:check`, `test`.
- **Tailwind v4 CSS-first with the FULL BRAND §9 `@theme` (every color/font/type-scale/radius/spacing token, `.glass`, `.tonal-card`, `prefers-reduced-motion` block) + Lexend/Inter/Material Symbols + root layout with base background** → Task 2 (`globals.css` copied verbatim plus base/icon layers; `layout.tsx` loads all three fonts; `page.tsx` proves token utilities render).
- **`docker-compose.yml` exactly per AGENT §9 (postgres:17, redis:7, minio) + `.env.example` skeleton per AGENT §10 / SPEC §11 (placeholders only)** → Task 3 (both copied verbatim; compose validated; shadow DB created).
- **Prisma 7: `prisma.config.ts`, `schema.prisma` with the COMPLETE SPEC §4 model (all enums + models verbatim, `provider="prisma-client"`, output `../src/generated/prisma`), `src/server/db.ts` (`@prisma/adapter-pg` + `pg` singleton), `src/server/redis.ts` (ioredis singleton), first migration `--name init`** → Task 4. `shadowDatabaseUrl` added per Global Constraints.
- **`prisma/seed.ts` idempotent admin upsert (inline argon2id) + gated demo payer/merchant, wired via `prisma.config.ts`; demo wallet/encryption stubbed so admin-only seed succeeds** → Task 5 (forward-references Phase 3 helpers; `SEED_DEMO` gate verified both on and off; idempotency verified).
- **Shared libs with full code + tests: `money.ts` (exact Money contract; phpToXlm ROUND_UP, formatXlm 7dp, formatPhp 2dp, availableXlm via decimal.js), `errors.ts` (AppError + all constructors), `http.ts` (route/json/parseBody/parseQuery — parseBody rejects invalid with badRequest; route renders AppError as the envelope with correct status), `vitest.config.ts`** → Tasks 6, 7, 8.

Contract conformance: `money.ts`, `errors.ts`, `http.ts` use the Locked Shared Contract signatures verbatim (`dec`, `formatXlm`, `formatPhp`, `displayPhp`, `displayXlm`, `phpToXlm`, `availableXlm`; `ErrorEnvelope`, `AppError`, the seven constructors; `Handler`, `HandlerContext`, `route`, `json`, `parseBody`, `parseQuery`). `Role` is imported type-only from `@/generated/prisma` (matches the overview). The only additions beyond the contracts are the additive `AppError.toEnvelope()` helper and a `globalThis` singleton pattern — neither renames or reshapes a locked signature.

No placeholders: every code step contains complete file contents; every command lists its expected output; the TDD tasks (6–8) follow failing-test → FAIL → implementation → PASS → commit, and scaffold/config tasks (1–5) are bite-sized and end in a Conventional Commit. Type names (`Decimal`, `Role`, `Merchant`, `PrismaClient`, `AppError`, `ErrorEnvelope`, `Handler`, `HandlerContext`) match the overview contracts.
