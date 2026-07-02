# Phase 3: Core Services — HeyPay

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan consumes the **Locked Shared Contracts** from `2026-06-28-heypay-00-overview.md` verbatim — never rename or re-shape a signature defined there.

**Goal:** Build the four custody/integration primitives every later phase depends on — AES-256-GCM envelope encryption, the Stellar custodial wallet service, the EMVCo QRPH decoder (TLV + CRC-16 + image + merchant resolution), and the S3/MinIO storage client — each behind the locked contract and unit-tested without touching the network.

**Architecture:** Pure server-only modules under `src/server/{crypto,stellar,qrph,storage}`. Secrets are decrypted only in-memory inside the signing service. The Horizon client is a lazily-constructed singleton injected into a `WalletService` factory so tests use a fake instead of the network. QRPH decoding is layered: `crc.ts` (checksum) → `tlv.ts` (generic parser) → `decode.ts` (EMVCo semantics + validation) → `resolve.ts` (DB lookup). Storage uses the AWS SDK v3 with path-style addressing for MinIO and re-validates uploaded objects by magic bytes.

**Tech Stack:** Node.js 22 `node:crypto` (AES-256-GCM) · `@stellar/stellar-sdk` v15.x + `sodium-native` (transparent fast signing) · `decimal.js` (via `@/lib/money`) · `jsqr` + `sharp` (image→pixels) · `qrcode` (test fixtures) · `@aws-sdk/client-s3` + `@aws-sdk/s3-presigned-post` + `@aws-sdk/s3-request-presigner` + `aws-sdk-client-mock` (dev) · Zod-free internal modules · Vitest.

**Depends on: Phase 1** — consumes `@/lib/money` (`Decimal`, `dec`, `formatXlm`), `@/lib/errors` (`badRequest`), `@/server/db` (`prisma`), the generated Prisma client (`@/generated/prisma`), the `@/*` path alias, and the Vitest config (which must alias `server-only` to a no-op — see Task 1, Step 0).

**Deliverable:** `envelope.ts`, `horizon.ts`, `wallet.ts`, `qrph/{crc,tlv,decode,resolve}.ts`, and `storage/s3.ts` (with `ensureBucket` bootstrap) implemented to their locked contracts, with green unit tests (encryption round-trip + tamper, CRC vectors, full static/dynamic decode, presign + magic-byte verify) and one network-gated Stellar testnet integration test.

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from `SPEC.md` / `AGENT.md` / the overview's Locked Shared Contracts.

- **Latest stable deps.** Install with `pnpm add <pkg>@latest`. `pnpm audit --prod` clean; lockfile committed; no `postinstall` from untrusted packages.
- **TypeScript `strict: true`.** No `any` at boundaries (a single localised cast of an injected Horizon fake in tests is permitted).
- **Money is `Decimal` only — never `number`/float.** XLM = 7 decimal places; PHP = 2. Stellar amounts are strings with ≤7 decimals via `@/lib/money`.
- **Secrets never reach client/logs/git/browser.** Every module in this phase begins with `import "server-only";`. Custodial Stellar secrets are envelope-encrypted (AES-256-GCM, `ENCRYPTION_MASTER_KEY` + `secretKeyVersion`). Decrypt only in-memory inside the signing service, only when submitting a tx. Never log secrets, account numbers, or wallet secrets.
- **Treat all external (Horizon / S3 / uploaded image / QR) responses as untrusted** — validate structure, currency, CRC, magic bytes, and size before acting.
- **Consistent error envelope.** User-facing validation failures throw `badRequest(...)` (from `@/lib/errors`); never leak stack traces or provider internals.
- **QRPH trust:** validate CRC-16/CCITT-FALSE and structure before trusting a code; resolve to a registered ACTIVE merchant; reject unverified / foreign-currency (≠ `608`) codes.
- **File uploads:** strict content-type + size limit in the presign policy; re-verify magic bytes + size server-side after upload; store under random keys; serve via signed URLs.
- **Commits:** Conventional Commits, small and focused. Naming: `camelCase` vars, `PascalCase` types, `SCREAMING_SNAKE` env.

---

## File Structure

| File                            | Responsibility                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/server/crypto/envelope.ts` | AES-256-GCM envelope encrypt/decrypt with a versioned keyring for rotation.                                                     |
| `src/server/stellar/horizon.ts` | Lazy `Horizon.Server` singleton + network passphrase selection from env.                                                        |
| `src/server/stellar/wallet.ts`  | `WalletService` factory (generate / getBalance / sendXlm / confirmTx / listIncomingPayments) over an injectable Horizon client. |
| `src/server/qrph/crc.ts`        | CRC-16/CCITT-FALSE checksum.                                                                                                    |
| `src/server/qrph/tlv.ts`        | Generic EMVCo TLV parser + nested template parser.                                                                              |
| `src/server/qrph/decode.ts`     | `decodeQrph` (semantics + CRC/currency validation) + `decodeQrphImage`.                                                         |
| `src/server/qrph/resolve.ts`    | `resolveMerchant` — match decoded QRPH to an ACTIVE merchant.                                                                   |
| `src/server/storage/s3.ts`      | S3/MinIO client, `presignUpload`, `verifyUploadedObject`, `signedGetUrl`, `ensureBucket`.                                       |
| `tests/server/**`               | Vitest unit + gated integration tests mirroring the above.                                                                      |

---

## Task 1: Envelope encryption (AES-256-GCM)

**Files:**

- Create: `src/server/crypto/envelope.ts`
- Test: `tests/server/crypto/envelope.test.ts`
- Modify (Step 0, if not already done in Phase 1): `vitest.config.ts`

**Interfaces:**

- Consumes: Node `node:crypto` only. Env: `ENCRYPTION_MASTER_KEY` (format `base64:<32-byte key>`), `ENCRYPTION_KEY_VERSION` (positive int), optional historical keys `ENCRYPTION_MASTER_KEY_V<n>=base64:...` for rotation.
- Produces (locked contract — `src/server/crypto/envelope.ts`):

  ```typescript
  // AES-256-GCM envelope encryption using ENCRYPTION_MASTER_KEY. Returns a self-describing string
  // "v<version>:<base64 iv>:<base64 tag>:<base64 ciphertext>".
  export function encryptSecret(plaintext: string): string;
  // Decrypts a string produced by encryptSecret; verifies auth tag; selects key by version prefix.
  export function decryptSecret(payload: string): string;
  // Test-only: clears the cached keyring so env changes take effect between tests.
  export function __resetKeyringForTests(): void;
  ```

- [ ] **Step 0: Ensure Vitest neutralises `server-only`**

Every module in this phase imports `server-only`, which throws if imported outside a React Server Component. Open `vitest.config.ts` and confirm the `resolve.alias` maps `server-only` to a stub; if missing, add it (create `tests/stubs/server-only.ts` with `export {};`).

```typescript
// vitest.config.ts — within defineConfig({ ... })
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: { environment: "node", globals: true },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
});
```

```typescript
// tests/stubs/server-only.ts
export {};
```

- [ ] **Step 1: Write the failing test**

```typescript
// tests/server/crypto/envelope.test.ts
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetKeyringForTests, decryptSecret, encryptSecret } from "@/server/crypto/envelope";

const KEY_B64 = randomBytes(32).toString("base64");

beforeEach(() => {
  process.env.ENCRYPTION_MASTER_KEY = `base64:${KEY_B64}`;
  process.env.ENCRYPTION_KEY_VERSION = "1";
  delete process.env.ENCRYPTION_MASTER_KEY_V2;
  __resetKeyringForTests();
});

describe("envelope encryption", () => {
  it("round-trips a secret", () => {
    const secret = "SCDV3...test-stellar-secret";
    const enc = encryptSecret(secret);
    expect(enc).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("uses a distinct IV per call (ciphertext differs)", () => {
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    expect(a).not.toBe(b);
    expect(a.split(":")[1]).not.toBe(b.split(":")[1]); // iv segment
  });

  it("throws on a tampered auth tag", () => {
    const enc = encryptSecret("secret");
    const [v, iv, tag, ct] = enc.split(":");
    const badTag = Buffer.from(tag, "base64");
    badTag[0] ^= 0xff;
    const tampered = [v, iv, badTag.toString("base64"), ct].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("throws on a malformed payload", () => {
    expect(() => decryptSecret("not-a-valid-payload")).toThrow(/format/i);
  });

  it("throws when no key exists for the payload version", () => {
    const enc = encryptSecret("secret");
    const v9 = enc.replace(/^v1:/, "v9:");
    expect(() => decryptSecret(v9)).toThrow(/version 9/);
  });

  it("decrypts a legacy version using a historical key (rotation)", () => {
    // Encrypt under v1, then rotate: v2 becomes current, v1 retained as historical.
    const legacy = encryptSecret("rotated-secret");
    process.env.ENCRYPTION_MASTER_KEY_V2 = `base64:${randomBytes(32).toString("base64")}`;
    process.env.ENCRYPTION_MASTER_KEY = process.env.ENCRYPTION_MASTER_KEY_V2;
    process.env.ENCRYPTION_KEY_VERSION = "2";
    process.env.ENCRYPTION_MASTER_KEY_V1 = `base64:${KEY_B64}`;
    __resetKeyringForTests();
    expect(encryptSecret("x")).toMatch(/^v2:/);
    expect(decryptSecret(legacy)).toBe("rotated-secret");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server/crypto/envelope.test.ts`
Expected: FAIL — "Cannot find module '@/server/crypto/envelope'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/server/crypto/envelope.ts
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length

type Keyring = { current: number; keys: Map<number, Buffer> };
let cached: Keyring | null = null;

function decodeKey(raw: string): Buffer {
  const b64 = raw.startsWith("base64:") ? raw.slice("base64:".length) : raw;
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_MASTER_KEY must decode to exactly 32 bytes (AES-256)");
  }
  return key;
}

function loadKeyring(): Keyring {
  if (cached) return cached;
  const master = process.env.ENCRYPTION_MASTER_KEY;
  if (!master) throw new Error("ENCRYPTION_MASTER_KEY is not set");
  const current = Number(process.env.ENCRYPTION_KEY_VERSION ?? "1");
  if (!Number.isInteger(current) || current < 1) {
    throw new Error("ENCRYPTION_KEY_VERSION must be a positive integer");
  }
  const keys = new Map<number, Buffer>();
  keys.set(current, decodeKey(master));
  for (const [name, value] of Object.entries(process.env)) {
    const m = /^ENCRYPTION_MASTER_KEY_V(\d+)$/.exec(name);
    if (m && value) keys.set(Number(m[1]), decodeKey(value));
  }
  cached = { current, keys };
  return cached;
}

export function __resetKeyringForTests(): void {
  cached = null;
}

export function encryptSecret(plaintext: string): string {
  const { current, keys } = loadKeyring();
  const key = keys.get(current);
  if (!key) throw new Error(`No key available for version ${current}`);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${current}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString(
    "base64",
  )}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || !/^v\d+$/.test(parts[0])) {
    throw new Error("Invalid ciphertext format");
  }
  const version = Number(parts[0].slice(1));
  const { keys } = loadKeyring();
  const key = keys.get(version);
  if (!key) throw new Error(`No key available for version ${version}`);
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ciphertext = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/server/crypto/envelope.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/crypto/envelope.ts tests/server/crypto/envelope.test.ts tests/stubs/server-only.ts vitest.config.ts
git commit -m "feat(crypto): AES-256-GCM envelope encryption with versioned keyring"
```

---

## Task 2: Horizon singleton

**Files:**

- Create: `src/server/stellar/horizon.ts`
- Test: `tests/server/stellar/horizon.test.ts`

**Interfaces:**

- Consumes: `@stellar/stellar-sdk` (`Horizon`, `Networks`). Env: `STELLAR_HORIZON_URL`, `STELLAR_NETWORK` (`testnet` | `mainnet`), `STELLAR_NETWORK_PASSPHRASE` (optional explicit override).
- Produces (`src/server/stellar/horizon.ts`):

  ```typescript
  import { Horizon } from "@stellar/stellar-sdk";
  // Lazily-constructed singleton Horizon.Server from STELLAR_HORIZON_URL.
  export function getHorizon(): Horizon.Server;
  // Resolve the network passphrase: explicit env wins, else PUBLIC for mainnet / TESTNET otherwise.
  export function getNetworkPassphrase(): string;
  // Test-only: drop the cached server so env changes take effect.
  export function __resetHorizonForTests(): void;
  ```

- [ ] **Step 1: Install the Stellar SDK + fast signing**

Run: `pnpm add @stellar/stellar-sdk@latest sodium-native@latest`
Note: `stellar-base` (bundled in the SDK) auto-detects `sodium-native` and uses it for fast ed25519 signing — no extra wiring needed.

- [ ] **Step 2: Write the failing test**

```typescript
// tests/server/stellar/horizon.test.ts
import { Horizon, Networks } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetHorizonForTests, getHorizon, getNetworkPassphrase } from "@/server/stellar/horizon";

beforeEach(() => {
  process.env.STELLAR_HORIZON_URL = "https://horizon-testnet.stellar.org";
  process.env.STELLAR_NETWORK = "testnet";
  delete process.env.STELLAR_NETWORK_PASSPHRASE;
  __resetHorizonForTests();
});

describe("horizon singleton", () => {
  it("returns a Horizon.Server and caches it", () => {
    const a = getHorizon();
    const b = getHorizon();
    expect(a).toBeInstanceOf(Horizon.Server);
    expect(a).toBe(b);
  });

  it("defaults to the testnet passphrase", () => {
    expect(getNetworkPassphrase()).toBe(Networks.TESTNET);
  });

  it("selects the public passphrase for mainnet", () => {
    process.env.STELLAR_NETWORK = "mainnet";
    expect(getNetworkPassphrase()).toBe(Networks.PUBLIC);
  });

  it("honours an explicit passphrase override", () => {
    process.env.STELLAR_NETWORK_PASSPHRASE = "Custom Net ; 2026";
    expect(getNetworkPassphrase()).toBe("Custom Net ; 2026");
  });

  it("throws when STELLAR_HORIZON_URL is missing", () => {
    delete process.env.STELLAR_HORIZON_URL;
    __resetHorizonForTests();
    expect(() => getHorizon()).toThrow(/STELLAR_HORIZON_URL/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/server/stellar/horizon.test.ts`
Expected: FAIL — "Cannot find module '@/server/stellar/horizon'".

- [ ] **Step 4: Write the implementation**

```typescript
// src/server/stellar/horizon.ts
import "server-only";
import { Horizon, Networks } from "@stellar/stellar-sdk";

let server: Horizon.Server | null = null;

export function getHorizon(): Horizon.Server {
  if (!server) {
    const url = process.env.STELLAR_HORIZON_URL;
    if (!url) throw new Error("STELLAR_HORIZON_URL is not set");
    server = new Horizon.Server(url, { allowHttp: url.startsWith("http://") });
  }
  return server;
}

export function getNetworkPassphrase(): string {
  const explicit = process.env.STELLAR_NETWORK_PASSPHRASE;
  if (explicit) return explicit;
  return process.env.STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
}

export function __resetHorizonForTests(): void {
  server = null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/server/stellar/horizon.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/stellar/horizon.ts tests/server/stellar/horizon.test.ts package.json pnpm-lock.yaml
git commit -m "feat(stellar): lazy Horizon.Server singleton + network passphrase selection"
```

---

## Task 3: Stellar wallet service

**Files:**

- Create: `src/server/stellar/wallet.ts`
- Test: `tests/server/stellar/wallet.test.ts`

**Interfaces:**

- Consumes: `@stellar/stellar-sdk` (`Asset`, `Keypair`, `Memo`, `Operation`, `TransactionBuilder`, `Horizon`, `StrKey`); `getHorizon`, `getNetworkPassphrase` (Task 2); `encryptSecret`, `decryptSecret` (Task 1); `Decimal`, `dec`, `formatXlm` (`@/lib/money`). Env: `ENCRYPTION_KEY_VERSION`.
- Produces (locked contract — `src/server/stellar/wallet.ts`):

  ```typescript
  import { Decimal } from "@/lib/money";
  export interface WalletService {
    generate(): { publicKey: string; encryptedSecret: string; secretKeyVersion: number };
    getBalance(publicKey: string): Promise<Decimal>;
    sendXlm(input: {
      encryptedSecret: string;
      destination: string;
      amountXlm: Decimal;
      memo: string;
    }): Promise<{ txHash: string }>;
    confirmTx(txHash: string): Promise<boolean>;
    listIncomingPayments(
      publicKey: string,
      cursor?: string,
    ): Promise<{ items: IncomingPayment[]; cursor?: string }>;
  }
  export type IncomingPayment = {
    id: string;
    amountXlm: Decimal;
    from: string;
    txHash: string;
    createdAt: Date;
  };
  // Factory: defaults resolve lazily (only when a method runs) so importing the module never hits the network.
  export function createWalletService(
    server?: Horizon.Server,
    networkPassphrase?: string,
  ): WalletService;
  export const walletService: WalletService;
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// tests/server/stellar/wallet.test.ts
import { randomBytes } from "node:crypto";
import type { Horizon } from "@stellar/stellar-sdk";
import { StrKey } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Decimal } from "@/lib/money";
import { __resetKeyringForTests, decryptSecret } from "@/server/crypto/envelope";
import { createWalletService } from "@/server/stellar/wallet";

const PASSPHRASE = "Test SDF Network ; September 2015";

beforeEach(() => {
  process.env.ENCRYPTION_MASTER_KEY = `base64:${randomBytes(32).toString("base64")}`;
  process.env.ENCRYPTION_KEY_VERSION = "1";
  __resetKeyringForTests();
});

// Minimal chainable fake of the Horizon.Server surface the wallet uses.
function fakeServer(overrides: Partial<Record<string, unknown>> = {}) {
  const base = {
    loadAccount: vi.fn(),
    fetchBaseFee: vi.fn().mockResolvedValue(100),
    submitTransaction: vi.fn(),
    transactions: vi.fn(),
    payments: vi.fn(),
    ...overrides,
  };
  return base as unknown as Horizon.Server;
}

describe("WalletService.generate", () => {
  it("produces a valid G-public key and a decryptable S-secret", () => {
    const svc = createWalletService(fakeServer(), PASSPHRASE);
    const { publicKey, encryptedSecret, secretKeyVersion } = svc.generate();
    expect(StrKey.isValidEd25519PublicKey(publicKey)).toBe(true);
    expect(publicKey.startsWith("G")).toBe(true);
    expect(secretKeyVersion).toBe(1);
    const secret = decryptSecret(encryptedSecret);
    expect(StrKey.isValidEd25519SecretSeed(secret)).toBe(true);
    expect(secret.startsWith("S")).toBe(true);
  });
});

describe("WalletService.getBalance", () => {
  it("parses the native balance from a Horizon account", async () => {
    const server = fakeServer({
      loadAccount: vi.fn().mockResolvedValue({
        balances: [
          { asset_type: "credit_alphanum4", balance: "5.0" },
          { asset_type: "native", balance: "123.4567890" },
        ],
      }),
    });
    const svc = createWalletService(server, PASSPHRASE);
    const bal = await svc.getBalance("GABC");
    expect(bal.equals(new Decimal("123.4567890"))).toBe(true);
  });

  it("returns 0 when the account is not yet funded (404)", async () => {
    const server = fakeServer({
      loadAccount: vi.fn().mockRejectedValue({ name: "NotFoundError", response: { status: 404 } }),
    });
    const svc = createWalletService(server, PASSPHRASE);
    expect((await svc.getBalance("GABC")).isZero()).toBe(true);
  });
});

describe("WalletService.sendXlm", () => {
  it("builds a native payment with memo and submits it", async () => {
    const sourceSvc = createWalletService(fakeServer(), PASSPHRASE);
    const { publicKey, encryptedSecret } = sourceSvc.generate();
    const submit = vi.fn().mockResolvedValue({ hash: "deadbeef" });
    const server = fakeServer({
      loadAccount: vi.fn().mockResolvedValue({
        accountId: () => publicKey,
        sequenceNumber: () => "1",
        incrementSequenceNumber: () => undefined,
      }),
      fetchBaseFee: vi.fn().mockResolvedValue(100),
      submitTransaction: submit,
    });
    const svc = createWalletService(server, PASSPHRASE);
    const res = await svc.sendXlm({
      encryptedSecret,
      destination: "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37",
      amountXlm: new Decimal("12.5"),
      memo: "TXN-ABC123",
    });
    expect(res.txHash).toBe("deadbeef");
    expect(submit).toHaveBeenCalledTimes(1);
    const tx = submit.mock.calls[0][0];
    expect(tx.memo.value.toString()).toBe("TXN-ABC123");
    expect(tx.operations[0].type).toBe("payment");
    expect(tx.operations[0].amount).toBe("12.5000000"); // 7dp formatXlm
    expect(tx.operations[0].asset.isNative()).toBe(true);
    expect(tx.timeBounds.maxTime).not.toBe("0"); // setTimeout applied
  });
});

describe("WalletService.confirmTx", () => {
  it("returns true for a successful tx", async () => {
    const call = vi.fn().mockResolvedValue({ successful: true });
    const server = fakeServer({
      transactions: vi.fn().mockReturnValue({ transaction: () => ({ call }) }),
    });
    const svc = createWalletService(server, PASSPHRASE);
    expect(await svc.confirmTx("abc")).toBe(true);
  });

  it("returns false for a failed tx", async () => {
    const call = vi.fn().mockResolvedValue({ successful: false });
    const server = fakeServer({
      transactions: vi.fn().mockReturnValue({ transaction: () => ({ call }) }),
    });
    const svc = createWalletService(server, PASSPHRASE);
    expect(await svc.confirmTx("abc")).toBe(false);
  });
});

describe("WalletService.listIncomingPayments", () => {
  it("maps native incoming payments and returns the new cursor", async () => {
    const records = [
      {
        id: "1",
        type: "payment",
        asset_type: "native",
        to: "GME",
        from: "GX",
        amount: "10.0",
        transaction_hash: "h1",
        created_at: "2026-06-28T00:00:00Z",
        paging_token: "c1",
      },
      {
        id: "2",
        type: "payment",
        asset_type: "native",
        to: "GOTHER",
        from: "GX",
        amount: "5.0",
        transaction_hash: "h2",
        created_at: "2026-06-28T00:01:00Z",
        paging_token: "c2",
      },
      {
        id: "3",
        type: "create_account",
        asset_type: "native",
        to: "GME",
        from: "GX",
        amount: "1.0",
        transaction_hash: "h3",
        created_at: "2026-06-28T00:02:00Z",
        paging_token: "c3",
      },
    ];
    const call = vi.fn().mockResolvedValue({ records });
    const builder = { order: vi.fn(), limit: vi.fn(), cursor: vi.fn(), call };
    builder.order.mockReturnValue(builder);
    builder.limit.mockReturnValue(builder);
    builder.cursor.mockReturnValue(builder);
    const server = fakeServer({
      payments: vi.fn().mockReturnValue({ forAccount: vi.fn().mockReturnValue(builder) }),
    });
    const svc = createWalletService(server, PASSPHRASE);
    const out = await svc.listIncomingPayments("GME", "c0");
    expect(out.items).toHaveLength(1); // only native payment TO GME
    expect(out.items[0].txHash).toBe("h1");
    expect(out.items[0].amountXlm.equals(new Decimal("10.0"))).toBe(true);
    expect(out.cursor).toBe("c3"); // advances past every scanned record
    expect(builder.cursor).toHaveBeenCalledWith("c0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server/stellar/wallet.test.ts`
Expected: FAIL — "Cannot find module '@/server/stellar/wallet'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/server/stellar/wallet.ts
import "server-only";
import { Asset, Horizon, Keypair, Memo, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { Decimal, dec, formatXlm } from "@/lib/money";
import { decryptSecret, encryptSecret } from "@/server/crypto/envelope";
import { getHorizon, getNetworkPassphrase } from "./horizon";

export type IncomingPayment = {
  id: string;
  amountXlm: Decimal;
  from: string;
  txHash: string;
  createdAt: Date;
};

export interface WalletService {
  generate(): { publicKey: string; encryptedSecret: string; secretKeyVersion: number };
  getBalance(publicKey: string): Promise<Decimal>;
  sendXlm(input: {
    encryptedSecret: string;
    destination: string;
    amountXlm: Decimal;
    memo: string;
  }): Promise<{ txHash: string }>;
  confirmTx(txHash: string): Promise<boolean>;
  listIncomingPayments(
    publicKey: string,
    cursor?: string,
  ): Promise<{ items: IncomingPayment[]; cursor?: string }>;
}

type HorizonBalance = { asset_type: string; balance: string };
type HorizonPaymentRecord = {
  id: string;
  type: string;
  asset_type: string;
  to: string;
  from: string;
  amount: string;
  transaction_hash: string;
  created_at: string;
  paging_token: string;
};

const TX_TIMEOUT_SECONDS = 180;
const CONFIRM_MAX_ATTEMPTS = 20;
const CONFIRM_DELAY_MS = 2000;
const PAGE_LIMIT = 50;

function isNotFound(e: unknown): boolean {
  const err = e as { name?: string; response?: { status?: number } };
  return err?.name === "NotFoundError" || err?.response?.status === 404;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createWalletService(
  server?: Horizon.Server,
  networkPassphrase?: string,
): WalletService {
  const srv = () => server ?? getHorizon();
  const net = () => networkPassphrase ?? getNetworkPassphrase();

  return {
    generate() {
      const kp = Keypair.random();
      const secretKeyVersion = Number(process.env.ENCRYPTION_KEY_VERSION ?? "1");
      return {
        publicKey: kp.publicKey(),
        encryptedSecret: encryptSecret(kp.secret()),
        secretKeyVersion,
      };
    },

    async getBalance(publicKey) {
      try {
        const account = await srv().loadAccount(publicKey);
        const balances = account.balances as HorizonBalance[];
        const native = balances.find((b) => b.asset_type === "native");
        return native ? dec(native.balance) : new Decimal(0);
      } catch (e) {
        if (isNotFound(e)) return new Decimal(0);
        throw e;
      }
    },

    async sendXlm({ encryptedSecret, destination, amountXlm, memo }) {
      // Decrypt only here, in-memory; `secret` never leaves this scope.
      const secret = decryptSecret(encryptedSecret);
      const keypair = Keypair.fromSecret(secret);
      const account = await srv().loadAccount(keypair.publicKey());
      const baseFee = await srv().fetchBaseFee();
      const tx = new TransactionBuilder(account, {
        fee: String(baseFee),
        networkPassphrase: net(),
      })
        .addOperation(
          Operation.payment({
            destination,
            asset: Asset.native(),
            amount: formatXlm(amountXlm),
          }),
        )
        .addMemo(Memo.text(memo))
        .setTimeout(TX_TIMEOUT_SECONDS)
        .build();
      tx.sign(keypair);
      const res = await srv().submitTransaction(tx);
      return { txHash: res.hash };
    },

    async confirmTx(txHash) {
      for (let attempt = 0; attempt < CONFIRM_MAX_ATTEMPTS; attempt++) {
        try {
          const tx = await srv().transactions().transaction(txHash).call();
          return tx.successful === true; // found in ledger -> definitive
        } catch (e) {
          if (!isNotFound(e)) throw e; // real error -> bubble up
          if (attempt < CONFIRM_MAX_ATTEMPTS - 1) await sleep(CONFIRM_DELAY_MS);
        }
      }
      return false; // never appeared within the window -> treat as not confirmed
    },

    async listIncomingPayments(publicKey, cursor) {
      let builder = srv().payments().forAccount(publicKey).order("asc").limit(PAGE_LIMIT);
      if (cursor) builder = builder.cursor(cursor);
      const page = await builder.call();
      const records = page.records as unknown as HorizonPaymentRecord[];
      const items: IncomingPayment[] = [];
      let newCursor = cursor;
      for (const rec of records) {
        newCursor = rec.paging_token;
        if (rec.type !== "payment") continue;
        if (rec.asset_type !== "native") continue;
        if (rec.to !== publicKey) continue;
        items.push({
          id: rec.id,
          amountXlm: dec(rec.amount),
          from: rec.from,
          txHash: rec.transaction_hash,
          createdAt: new Date(rec.created_at),
        });
      }
      return { items, cursor: newCursor };
    },
  };
}

export const walletService: WalletService = createWalletService();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/server/stellar/wallet.test.ts`
Expected: PASS (7 tests). The `confirmTx` tests find the tx on the first attempt, so no `sleep` runs.

- [ ] **Step 5: Add the network-gated testnet integration test**

```typescript
// tests/server/stellar/wallet.integration.test.ts
import { randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { beforeAll, describe, expect, it } from "vitest";
import { __resetKeyringForTests } from "@/server/crypto/envelope";
import { __resetHorizonForTests } from "@/server/stellar/horizon";
import { createWalletService } from "@/server/stellar/wallet";

// Only runs against live testnet + friendbot. Skipped in normal/CI unit runs.
const RUN = process.env.STELLAR_NETWORK === "testnet" && process.env.RUN_STELLAR_IT === "1";

describe.skipIf(!RUN)("WalletService (testnet integration)", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_MASTER_KEY = `base64:${randomBytes(32).toString("base64")}`;
    process.env.ENCRYPTION_KEY_VERSION = "1";
    process.env.STELLAR_HORIZON_URL = "https://horizon-testnet.stellar.org";
    __resetKeyringForTests();
    __resetHorizonForTests();
  });

  it("funds a new account via friendbot and reads a positive balance", async () => {
    const svc = createWalletService();
    const kp = Keypair.random();
    const res = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
    expect(res.ok).toBe(true);
    const bal = await svc.getBalance(kp.publicKey());
    expect(bal.greaterThan(0)).toBe(true);
  }, 30_000);
});
```

Run (optional, network): `RUN_STELLAR_IT=1 STELLAR_NETWORK=testnet pnpm vitest run tests/server/stellar/wallet.integration.test.ts`
Expected: PASS when online; SKIPPED otherwise (so `pnpm vitest run` stays offline-safe).

- [ ] **Step 6: Commit**

```bash
git add src/server/stellar/wallet.ts tests/server/stellar/wallet.test.ts tests/server/stellar/wallet.integration.test.ts
git commit -m "feat(stellar): custodial WalletService (generate/balance/send/confirm/list) over injectable Horizon"
```

---

## Task 4: QRPH CRC-16/CCITT-FALSE

**Files:**

- Create: `src/server/qrph/crc.ts`
- Test: `tests/server/qrph/crc.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces (`src/server/qrph/crc.ts`):

  ```typescript
  // CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection, xorout 0x0000).
  // Returns 4 uppercase hex chars, computed over the payload up to and including "6304".
  export function crc16ccitt(data: string): string;
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// tests/server/qrph/crc.test.ts
import { describe, expect, it } from "vitest";
import { crc16ccitt } from "@/server/qrph/crc";

describe("crc16ccitt", () => {
  it("matches the canonical CRC-16/CCITT-FALSE check value", () => {
    // "123456789" -> 0x29B1 is the published check value for this CRC variant.
    expect(crc16ccitt("123456789")).toBe("29B1");
  });

  it("matches the CRC for a real PH static QRPH body (ending in 6304)", () => {
    const body =
      "00020101021126290010com.heypay0111HEYPAY123455204599953036085802PH5913HEYPAY COFFEE6006MANILA6304";
    expect(crc16ccitt(body)).toBe("3EAC");
  });

  it("detects a one-character change", () => {
    expect(crc16ccitt("123456789")).not.toBe(crc16ccitt("12345678X"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server/qrph/crc.test.ts`
Expected: FAIL — "Cannot find module '@/server/qrph/crc'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/server/qrph/crc.ts
import "server-only";

const POLY = 0x1021;

export function crc16ccitt(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ POLY) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/server/qrph/crc.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/qrph/crc.ts tests/server/qrph/crc.test.ts
git commit -m "feat(qrph): CRC-16/CCITT-FALSE checksum"
```

---

## Task 5: Generic EMVCo TLV parser

**Files:**

- Create: `src/server/qrph/tlv.ts`
- Test: `tests/server/qrph/tlv.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces (`src/server/qrph/tlv.ts`):

  ```typescript
  export type TlvNode = { tag: string; length: number; value: string };
  // Parse a flat EMVCo TLV string (2-char tag, 2-digit length, value) into ordered nodes.
  // Throws on malformed length or value overrun.
  export function parseTlv(input: string): TlvNode[];
  // Build a tag->value map from nodes (last occurrence wins).
  export function toMap(nodes: TlvNode[]): Record<string, string>;
  // Parse a nested template value (e.g. a merchant-account-info template) into a sub-tag map.
  export function parseTemplate(value: string): Record<string, string>;
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// tests/server/qrph/tlv.test.ts
import { describe, expect, it } from "vitest";
import { parseTemplate, parseTlv, toMap } from "@/server/qrph/tlv";

const STATIC =
  "00020101021126290010com.heypay0111HEYPAY123455204599953036085802PH5913HEYPAY COFFEE6006MANILA63043EAC";

describe("parseTlv", () => {
  it("parses top-level tags in order", () => {
    const nodes = parseTlv(STATIC);
    const map = toMap(nodes);
    expect(map["00"]).toBe("01"); // payload format
    expect(map["01"]).toBe("11"); // static
    expect(map["53"]).toBe("608"); // currency PHP
    expect(map["58"]).toBe("PH");
    expect(map["59"]).toBe("HEYPAY COFFEE");
    expect(map["63"]).toBe("3EAC"); // CRC value
  });

  it("exposes the nested merchant-account-info template (tag 26)", () => {
    const map = toMap(parseTlv(STATIC));
    const sub = parseTemplate(map["26"]);
    expect(sub["00"]).toBe("com.heypay"); // GUI / acquirer
    expect(sub["01"]).toBe("HEYPAY12345"); // merchant id
  });

  it("throws when a declared length overruns the input", () => {
    expect(() => parseTlv("0099AB")).toThrow(/overrun|truncated|length/i);
  });

  it("throws on a non-numeric length", () => {
    expect(() => parseTlv("00XX01")).toThrow(/length/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server/qrph/tlv.test.ts`
Expected: FAIL — "Cannot find module '@/server/qrph/tlv'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/server/qrph/tlv.ts
import "server-only";

export type TlvNode = { tag: string; length: number; value: string };

export function parseTlv(input: string): TlvNode[] {
  const nodes: TlvNode[] = [];
  let i = 0;
  while (i < input.length) {
    if (i + 4 > input.length) throw new Error(`TLV truncated at position ${i}`);
    const tag = input.slice(i, i + 2);
    const lenStr = input.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(lenStr)) throw new Error(`Invalid TLV length "${lenStr}" at position ${i}`);
    const length = Number(lenStr);
    const start = i + 4;
    const end = start + length;
    if (end > input.length) throw new Error(`TLV value overrun at tag ${tag}`);
    nodes.push({ tag, length, value: input.slice(start, end) });
    i = end;
  }
  return nodes;
}

export function toMap(nodes: TlvNode[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const node of nodes) map[node.tag] = node.value;
  return map;
}

export function parseTemplate(value: string): Record<string, string> {
  return toMap(parseTlv(value));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/server/qrph/tlv.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/qrph/tlv.ts tests/server/qrph/tlv.test.ts
git commit -m "feat(qrph): generic EMVCo TLV + nested template parser"
```

---

## Task 6: QRPH decode (semantics + CRC/currency validation + image)

**Files:**

- Create: `src/server/qrph/decode.ts`
- Test: `tests/server/qrph/decode.test.ts`

**Interfaces:**

- Consumes: `crc16ccitt` (Task 4); `parseTlv`, `parseTemplate`, `toMap` (Task 5); `badRequest` (`@/lib/errors`); `jsqr`; `sharp`; (test only) `qrcode`.
- Produces (locked contract — `src/server/qrph/decode.ts`):

  ```typescript
  export type QrphDecoded = {
    raw: string;
    payloadFormat: string; // tag 00
    pointOfInit: "static" | "dynamic"; // tag 01: 11=static, 12=dynamic
    merchantName?: string; // tag 59
    merchantCity?: string; // tag 60
    merchantId?: string; // from merchant account info template
    acquirerId?: string;
    country: string; // tag 58 (default PH)
    currency: string; // tag 53 (608 = PHP)
    amountPhp?: string; // tag 54 (present for dynamic QR)
    crcValid: boolean;
  };
  // Parse raw EMVCo TLV string and validate CRC-16/CCITT-FALSE. Throws badRequest if structure/CRC/currency invalid.
  export function decodeQrph(raw: string): QrphDecoded;
  // Decode a QR image buffer to its raw string (sharp -> pixels -> jsqr), then decodeQrph.
  export function decodeQrphImage(image: Buffer): Promise<QrphDecoded>;
  ```

- [ ] **Step 1: Install image-decode dependencies**

Run: `pnpm add jsqr@latest sharp@latest && pnpm add -D qrcode@latest @types/qrcode@latest`
Note: `jsqr` needs raw RGBA pixels, so `sharp` decodes the uploaded PNG/JPEG buffer into pixels first. `qrcode` is dev-only, used to synthesise a scannable QR image fixture in the test.

- [ ] **Step 2: Write the failing test**

```typescript
// tests/server/qrph/decode.test.ts
import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { decodeQrph, decodeQrphImage } from "@/server/qrph/decode";

const STATIC =
  "00020101021126290010com.heypay0111HEYPAY123455204599953036085802PH5913HEYPAY COFFEE6006MANILA63043EAC";
const DYNAMIC =
  "00020101021226290010com.heypay0111HEYPAY123455204599953036085406150.005802PH5913HEYPAY COFFEE6006MANILA6304B875";
const FOREIGN_USD =
  "00020101021126290010com.heypay0111HEYPAY123455204599953038405802PH5913HEYPAY COFFEE6006MANILA6304B266";

describe("decodeQrph", () => {
  it("decodes a valid static PH QRPH", () => {
    const d = decodeQrph(STATIC);
    expect(d.crcValid).toBe(true);
    expect(d.pointOfInit).toBe("static");
    expect(d.currency).toBe("608");
    expect(d.country).toBe("PH");
    expect(d.merchantName).toBe("HEYPAY COFFEE");
    expect(d.merchantCity).toBe("MANILA");
    expect(d.acquirerId).toBe("com.heypay");
    expect(d.merchantId).toBe("HEYPAY12345");
    expect(d.amountPhp).toBeUndefined();
  });

  it("decodes a dynamic QRPH and extracts the embedded amount", () => {
    const d = decodeQrph(DYNAMIC);
    expect(d.pointOfInit).toBe("dynamic");
    expect(d.amountPhp).toBe("150.00");
  });

  it("rejects a bad CRC", () => {
    const bad = STATIC.slice(0, -1) + "0"; // mangle last CRC char
    expect(() => decodeQrph(bad)).toThrow(/crc/i);
  });

  it("rejects a foreign currency (not 608)", () => {
    expect(() => decodeQrph(FOREIGN_USD)).toThrow(/currency/i);
  });

  it("rejects a string with no CRC tag", () => {
    expect(() => decodeQrph("0002010102")).toThrow();
  });
});

describe("decodeQrphImage", () => {
  it("reads the raw string from a rendered QR image then decodes it", async () => {
    const png = await QRCode.toBuffer(STATIC, {
      type: "png",
      errorCorrectionLevel: "M",
      width: 512,
    });
    const d = await decodeQrphImage(png);
    expect(d.merchantId).toBe("HEYPAY12345");
    expect(d.currency).toBe("608");
  }, 15_000);

  it("throws when the image contains no QR code", async () => {
    const blank = await QRCode.toBuffer("ignored", { type: "png" });
    // Replace with a non-QR PNG: a 1x1 transparent pixel buffer is not scannable.
    const tiny = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f1c0000000049454e44ae426082",
      "hex",
    );
    await expect(decodeQrphImage(tiny)).rejects.toThrow(/qr/i);
    void blank;
  }, 15_000);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/server/qrph/decode.test.ts`
Expected: FAIL — "Cannot find module '@/server/qrph/decode'".

- [ ] **Step 4: Write the implementation**

```typescript
// src/server/qrph/decode.ts
import "server-only";
import jsQR from "jsqr";
import sharp from "sharp";
import { badRequest } from "@/lib/errors";
import { crc16ccitt } from "./crc";
import { parseTemplate, parseTlv, toMap } from "./tlv";

export type QrphDecoded = {
  raw: string;
  payloadFormat: string;
  pointOfInit: "static" | "dynamic";
  merchantName?: string;
  merchantCity?: string;
  merchantId?: string;
  acquirerId?: string;
  country: string;
  currency: string;
  amountPhp?: string;
  crcValid: boolean;
};

const PHP_CURRENCY = "608";

export function decodeQrph(raw: string): QrphDecoded {
  const trimmed = raw.trim();
  // CRC is always the final tag: "63" "04" + 4 hex chars (8 chars total).
  if (trimmed.length < 8 || trimmed.slice(-8, -4) !== "6304") {
    throw badRequest("QRPH is missing its CRC tag");
  }
  const provided = trimmed.slice(-4).toUpperCase();
  const computed = crc16ccitt(trimmed.slice(0, -4)); // includes "6304"
  if (provided !== computed) throw badRequest("QRPH CRC validation failed");

  let nodes;
  try {
    nodes = parseTlv(trimmed);
  } catch {
    throw badRequest("QRPH is not a valid EMVCo TLV string");
  }
  const map = toMap(nodes);

  const payloadFormat = map["00"];
  if (!payloadFormat) throw badRequest("QRPH is missing the payload format (tag 00)");

  const currency = map["53"] ?? "";
  if (currency !== PHP_CURRENCY) {
    throw badRequest("QRPH currency is not PHP (608)");
  }

  let acquirerId: string | undefined;
  let merchantId: string | undefined;
  for (const node of nodes) {
    const tagNum = Number(node.tag);
    if (tagNum >= 26 && tagNum <= 51) {
      const sub = parseTemplate(node.value);
      acquirerId ??= sub["00"];
      merchantId ??= sub["01"] ?? sub["02"] ?? sub["03"];
    }
  }

  return {
    raw: trimmed,
    payloadFormat,
    pointOfInit: map["01"] === "12" ? "dynamic" : "static",
    merchantName: map["59"],
    merchantCity: map["60"],
    merchantId,
    acquirerId,
    country: map["58"] ?? "PH",
    currency,
    amountPhp: map["54"],
    crcValid: true,
  };
}

async function readQrFromImage(image: Buffer): Promise<string | null> {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const result = jsQR(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    info.width,
    info.height,
  );
  return result?.data ?? null;
}

export async function decodeQrphImage(image: Buffer): Promise<QrphDecoded> {
  const raw = await readQrFromImage(image);
  if (!raw) throw badRequest("Could not read a QR code from the image");
  return decodeQrph(raw);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/server/qrph/decode.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/qrph/decode.ts tests/server/qrph/decode.test.ts package.json pnpm-lock.yaml
git commit -m "feat(qrph): EMVCo decode with CRC/currency validation + image decode"
```

---

## Task 7: QRPH merchant resolution

**Files:**

- Create: `src/server/qrph/resolve.ts`
- Test: `tests/server/qrph/resolve.test.ts`

**Interfaces:**

- Consumes: `prisma` (`@/server/db`); `Merchant`, `MerchantStatus` (`@/generated/prisma`); `QrphDecoded` (Task 6).
- Produces (locked contract — `src/server/qrph/resolve.ts`):

  ```typescript
  import { Merchant } from "@/generated/prisma";
  import type { QrphDecoded } from "./decode";
  // Resolve decoded QRPH to a registered ACTIVE merchant or null.
  export function resolveMerchant(decoded: QrphDecoded): Promise<Merchant | null>;
  ```

- [ ] **Step 1: Write the failing test**

```typescript
// tests/server/qrph/resolve.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
vi.mock("@/server/db", () => ({ prisma: { merchant: { findFirst } } }));

import { MerchantStatus } from "@/generated/prisma";
import type { QrphDecoded } from "@/server/qrph/decode";
import { resolveMerchant } from "@/server/qrph/resolve";

const decoded: QrphDecoded = {
  raw: "RAW-STRING",
  payloadFormat: "01",
  pointOfInit: "static",
  merchantId: "HEYPAY12345",
  acquirerId: "com.heypay",
  country: "PH",
  currency: "608",
  crcValid: true,
};

beforeEach(() => findFirst.mockReset());

describe("resolveMerchant", () => {
  it("returns the matching ACTIVE merchant", async () => {
    findFirst.mockResolvedValue({ id: "m1", businessName: "HeyPay Coffee" });
    const m = await resolveMerchant(decoded);
    expect(m).toEqual({ id: "m1", businessName: "HeyPay Coffee" });
    const where = findFirst.mock.calls[0][0].where;
    expect(where.status).toBe(MerchantStatus.ACTIVE);
    expect(where.OR).toEqual(
      expect.arrayContaining([{ qrphRaw: "RAW-STRING" }, { qrphMerchantId: "HEYPAY12345" }]),
    );
  });

  it("returns null on a miss", async () => {
    findFirst.mockResolvedValue(null);
    expect(await resolveMerchant(decoded)).toBeNull();
  });

  it("matches by raw only when no merchantId is present", async () => {
    findFirst.mockResolvedValue(null);
    await resolveMerchant({ ...decoded, merchantId: undefined });
    expect(findFirst.mock.calls[0][0].where.OR).toEqual([{ qrphRaw: "RAW-STRING" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/server/qrph/resolve.test.ts`
Expected: FAIL — "Cannot find module '@/server/qrph/resolve'".

- [ ] **Step 3: Write the implementation**

```typescript
// src/server/qrph/resolve.ts
import "server-only";
import { Merchant, MerchantStatus, Prisma } from "@/generated/prisma";
import { prisma } from "@/server/db";
import type { QrphDecoded } from "./decode";

export function resolveMerchant(decoded: QrphDecoded): Promise<Merchant | null> {
  const or: Prisma.MerchantWhereInput[] = [{ qrphRaw: decoded.raw }];
  if (decoded.merchantId) or.push({ qrphMerchantId: decoded.merchantId });
  return prisma.merchant.findFirst({
    where: { status: MerchantStatus.ACTIVE, OR: or },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/server/qrph/resolve.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/qrph/resolve.ts tests/server/qrph/resolve.test.ts
git commit -m "feat(qrph): resolve decoded QRPH to an ACTIVE merchant"
```

---

## Task 8: S3/MinIO storage (presign, magic-byte verify, signed GET, bucket bootstrap)

**Files:**

- Create: `src/server/storage/s3.ts`
- Test: `tests/server/storage/s3.test.ts`

**Interfaces:**

- Consumes: `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, `@aws-sdk/s3-request-presigner`, `node:crypto` (`randomUUID`); `badRequest` (`@/lib/errors`); (test) `aws-sdk-client-mock`. Env: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`.
- Produces (locked contract — `src/server/storage/s3.ts`):

  ```typescript
  export type PresignResult = { url: string; fields: Record<string, string>; key: string };
  // Presigned POST for an upload of given content type; enforces size limit server-side in the policy.
  export function presignUpload(input: {
    prefix: "qrph" | "logo";
    contentType: string;
    maxBytes: number;
  }): Promise<PresignResult>;
  // Verify an uploaded object's magic bytes + size match an allowed image type; throws badRequest if not.
  export function verifyUploadedObject(key: string): Promise<void>;
  // Return a time-limited signed GET URL for an object key.
  export function signedGetUrl(key: string): Promise<string>;
  // Create the configured bucket if it does not exist. Callable on app/worker start (MinIO bootstrap).
  export function ensureBucket(): Promise<void>;
  // Test-only: drop the cached S3 client.
  export function __resetS3ForTests(): void;
  ```

- [ ] **Step 1: Install storage dependencies**

Run: `pnpm add @aws-sdk/client-s3@latest @aws-sdk/s3-presigned-post@latest @aws-sdk/s3-request-presigner@latest && pnpm add -D aws-sdk-client-mock@latest`

- [ ] **Step 2: Write the failing test**

```typescript
// tests/server/storage/s3.test.ts
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createPresignedPost = vi.fn();
vi.mock("@aws-sdk/s3-presigned-post", () => ({ createPresignedPost }));

import {
  __resetS3ForTests,
  ensureBucket,
  presignUpload,
  verifyUploadedObject,
} from "@/server/storage/s3";

const s3Mock = mockClient(S3Client);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NOT_IMAGE = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"

beforeEach(() => {
  process.env.S3_BUCKET = "heypay-uploads";
  process.env.S3_REGION = "us-east-1";
  process.env.S3_ENDPOINT = "http://localhost:9000";
  process.env.S3_ACCESS_KEY = "heypay";
  process.env.S3_SECRET_KEY = "heypay-secret";
  process.env.S3_FORCE_PATH_STYLE = "true";
  s3Mock.reset();
  createPresignedPost.mockReset();
  __resetS3ForTests();
});
afterEach(() => vi.clearAllMocks());

describe("presignUpload", () => {
  it("returns a random key under the prefix and a size-bounded policy", async () => {
    createPresignedPost.mockResolvedValue({
      url: "http://localhost:9000/heypay-uploads",
      fields: { key: "x" },
    });
    const out = await presignUpload({
      prefix: "qrph",
      contentType: "image/png",
      maxBytes: 1_000_000,
    });
    expect(out.key).toMatch(/^qrph\/[0-9a-f-]+\.png$/);
    expect(out.url).toContain("heypay-uploads");
    const args = createPresignedPost.mock.calls[0][1];
    expect(args.Conditions).toEqual(
      expect.arrayContaining([["content-length-range", 1, 1_000_000]]),
    );
  });

  it("rejects an unsupported content type", async () => {
    await expect(
      presignUpload({ prefix: "logo", contentType: "image/gif", maxBytes: 1000 }),
    ).rejects.toThrow(/content type/i);
  });
});

describe("verifyUploadedObject", () => {
  it("accepts a valid PNG", async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 1024 });
    s3Mock.on(GetObjectCommand).resolves({
      Body: { transformToByteArray: async () => PNG } as never,
    });
    await expect(verifyUploadedObject("qrph/abc.png")).resolves.toBeUndefined();
  });

  it("rejects non-image magic bytes", async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 1024 });
    s3Mock.on(GetObjectCommand).resolves({
      Body: { transformToByteArray: async () => NOT_IMAGE } as never,
    });
    await expect(verifyUploadedObject("qrph/abc.png")).rejects.toThrow(/png or jpeg/i);
  });

  it("rejects an oversize object", async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 99_000_000 });
    await expect(verifyUploadedObject("qrph/abc.png")).rejects.toThrow(/size/i);
  });
});

describe("ensureBucket", () => {
  it("creates the bucket when it does not exist", async () => {
    s3Mock.on(HeadBucketCommand).rejects({ $metadata: { httpStatusCode: 404 } });
    s3Mock.on(CreateBucketCommand).resolves({});
    await ensureBucket();
    expect(s3Mock.commandCalls(CreateBucketCommand)).toHaveLength(1);
  });

  it("is a no-op when the bucket already exists", async () => {
    s3Mock.on(HeadBucketCommand).resolves({});
    await ensureBucket();
    expect(s3Mock.commandCalls(CreateBucketCommand)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/server/storage/s3.test.ts`
Expected: FAIL — "Cannot find module '@/server/storage/s3'".

- [ ] **Step 4: Write the implementation**

```typescript
// src/server/storage/s3.ts
import "server-only";
import { randomUUID } from "node:crypto";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { badRequest } from "@/lib/errors";

export type PresignResult = { url: string; fields: Record<string, string>; key: string };

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};
const MAX_OBJECT_BYTES = 5 * 1024 * 1024; // 5 MiB hard cap on verify
const PRESIGN_EXPIRES_SEC = 300;
const GET_URL_EXPIRES_SEC = 300;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

let client: S3Client | null = null;

function getS3(): S3Client {
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? "",
        secretAccessKey: process.env.S3_SECRET_KEY ?? "",
      },
    });
  }
  return client;
}

function bucket(): string {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET is not set");
  return b;
}

export function __resetS3ForTests(): void {
  client = null;
}

export async function presignUpload(input: {
  prefix: "qrph" | "logo";
  contentType: string;
  maxBytes: number;
}): Promise<PresignResult> {
  const ext = ALLOWED_CONTENT_TYPES[input.contentType];
  if (!ext) throw badRequest("Unsupported upload content type", { contentType: input.contentType });
  const key = `${input.prefix}/${randomUUID()}.${ext}`;
  const { url, fields } = await createPresignedPost(getS3(), {
    Bucket: bucket(),
    Key: key,
    Conditions: [
      ["content-length-range", 1, input.maxBytes],
      ["eq", "$Content-Type", input.contentType],
    ],
    Fields: { "Content-Type": input.contentType },
    Expires: PRESIGN_EXPIRES_SEC,
  });
  return { url, fields, key };
}

export async function verifyUploadedObject(key: string): Promise<void> {
  const head = await getS3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
  const size = head.ContentLength ?? 0;
  if (size <= 0 || size > MAX_OBJECT_BYTES) {
    throw badRequest("Uploaded object size is out of bounds");
  }
  const obj = await getS3().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key, Range: "bytes=0-7" }),
  );
  if (!obj.Body) throw badRequest("Uploaded object has no body");
  const bytes = Buffer.from(await obj.Body.transformToByteArray());
  const isPng = bytes.subarray(0, 8).equals(PNG_MAGIC);
  const isJpeg = bytes.subarray(0, 3).equals(JPEG_MAGIC);
  if (!isPng && !isJpeg) throw badRequest("Uploaded file is not a valid PNG or JPEG");
}

export function signedGetUrl(key: string): Promise<string> {
  return getSignedUrl(getS3(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
    expiresIn: GET_URL_EXPIRES_SEC,
  });
}

export async function ensureBucket(): Promise<void> {
  const name = bucket();
  try {
    await getS3().send(new HeadBucketCommand({ Bucket: name }));
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    const notFound =
      status === 404 || status === 301 || (e as { name?: string })?.name === "NotFound";
    if (!notFound) throw e;
    await getS3().send(new CreateBucketCommand({ Bucket: name }));
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/server/storage/s3.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Verify the whole phase together**

Run: `pnpm vitest run tests/server/crypto tests/server/stellar tests/server/qrph tests/server/storage`
Expected: PASS — all unit tests across Tasks 1–8 (the testnet integration test is SKIPPED).
Run: `pnpm typecheck`
Expected: PASS — no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/server/storage/s3.ts tests/server/storage/s3.test.ts package.json pnpm-lock.yaml
git commit -m "feat(storage): S3/MinIO presign + magic-byte verify + signed GET + bucket bootstrap"
```

---

## Self-Review

**AGENT §6 (Security — money + custody) coverage:**

- _Custodial key protection (envelope encryption, AES-256-GCM, master key + `secretKeyVersion` rotation, decrypt in-memory only):_ Task 1 (encrypt/decrypt + versioned keyring + rotation test); Task 3 `sendXlm` decrypts only inside the method scope, never returns/logs the secret, and `generate()` stamps `secretKeyVersion` from env.
- _Signing isolation (signing lives only in `server/stellar`):_ Tasks 2–3 are `server-only`; the secret crosses no module boundary into a request/response path.
- _File uploads (presigned + content-type + size limit, magic-byte verify, random keys, signed URLs):_ Task 8 — `presignUpload` (content-type allowlist + `content-length-range` policy + `randomUUID` keys), `verifyUploadedObject` (HEAD size cap + PNG/JPEG magic bytes), `signedGetUrl`.
- _QRPH trust (validate CRC-16 + structure, reject foreign currency, resolve to a registered merchant):_ Task 4 (CRC), Task 5 (TLV structure), Task 6 (`decodeQrph` rejects bad CRC and currency ≠ 608), Task 7 (resolve to ACTIVE merchant or null).
- _Treat external responses as untrusted:_ Horizon responses validated/typed (Task 3), uploaded objects re-verified (Task 8), QR payloads CRC- and currency-checked (Task 6).
- _No secrets/PII in logs:_ validation failures surface as `badRequest` with no secret material; secrets are local consts.

**AGENT §7 (Stellar specifics) coverage:**

- `Horizon.Server` configured per env (Task 2). Amounts are strings ≤7dp via `formatXlm` (Task 3). Timebounds via `setTimeout(180)` and fee via `fetchBaseFee` (Task 3 `sendXlm`). Success confirmed by polling the tx result, submit ≠ success (Task 3 `confirmTx`). Account-not-funded handled (Task 3 `getBalance` returns 0 on 404). Persisted cursor for the deposit poller, idempotent (Task 3 `listIncomingPayments` returns + accepts a cursor). `sodium-native` installed for fast signing (Task 2 Step 1).

**SPEC §7.1 (Stellar) / §7.3 (QRPH) coverage:**

- §7.1: network env config, custodial keypair gen + envelope-encrypted secret, prefund detection via `payments().forAccount` + cursor, payment build (native op + memo + base fee + timebounds), tx-hash return, poll confirmation — all in Tasks 2–3.
- §7.3: TLV parse of tags 00/01/26–51/52/53/54/58/59/60/62/63, CRC-16/CCITT-FALSE over payload up to and including `6304`, image decode (sharp+jsqr), merchant resolution by identifier/raw — Tasks 4–7. `pointOfInit` mapped 11→static / 12→dynamic; embedded amount (tag 54) surfaced for dynamic QR.

**SPEC §4.1x / §6 uploads (data shapes) coverage:** `PresignResult { url, fields, key }` matches the locked contract and the `POST /api/uploads/presign` `{url, fields, key}` response shape (Task 8); re-validation after upload satisfies "re-validate the object after upload."

**Locked-contract signature consistency:** `encryptSecret`/`decryptSecret` (Task 1), `WalletService` + `IncomingPayment` + `walletService` (Task 3), `QrphDecoded` + `decodeQrph`/`decodeQrphImage` (Task 6), `resolveMerchant` (Task 7), `PresignResult` + `presignUpload`/`verifyUploadedObject`/`signedGetUrl` (Task 8) are reproduced verbatim from the overview's Locked Shared Contracts. Additions beyond the contracts are non-breaking helpers: `getHorizon`/`getNetworkPassphrase` (Task 2), `createWalletService` factory (Task 3), `crc16ccitt` (Task 4), `parseTlv`/`toMap`/`parseTemplate`/`TlvNode` (Task 5), `ensureBucket` (Task 8, required by overview Phase-3 deliverable "Bucket bootstrap helper for MinIO"), and `__reset*ForTests` test seams.

**Placeholder scan:** No "TBD", "TODO", "implement later", "add appropriate X", or "similar to Task N" remain. Every code step shows complete code; every test step shows full assertions; CRC and QRPH vectors were computed with a real CRC-16/CCITT-FALSE implementation (`123456789`→`29B1`; static→`3EAC`; dynamic→`B875`; USD foreign→`B266`) so the expected values are accurate.

**Cross-task type consistency check:** `Decimal`/`dec`/`formatXlm` used identically (Phase 1 contract); `badRequest` used identically (Phase 1 contract); `QrphDecoded` produced in Task 6 and consumed unchanged in Task 7; `TlvNode`/`parseTlv`/`toMap`/`parseTemplate` produced in Task 5 and consumed unchanged in Task 6; Horizon fake in Task 3 implements exactly the methods the implementation calls (`loadAccount`, `fetchBaseFee`, `submitTransaction`, `transactions().transaction().call()`, `payments().forAccount().order().limit().cursor().call()`).
