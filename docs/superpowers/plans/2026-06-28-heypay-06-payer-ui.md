# Phase 6: Payer UI — HeyPay

> The Payer-facing web surfaces: the themed component library and every `/payer/*` screen from SPEC §5. This phase turns the locked API contracts from Phases 2–5 into the visible product — dashboard, scan, confirm/pay (with the processing overlay), prefund, transactions, and settings — all styled strictly with BRAND.md tokens, accessible (WCAG AA, reduced-motion, ≥44px targets, status-by-text+badge), and responsive (SideNav on `lg+`, bottom nav below).

**Goal:** Build the complete Payer experience — shared themed UI primitives plus all six `/payer/*` routes and the `(payer)` layout — consuming only the Phase 2–5 API endpoints and shared contracts, with every screen's key structure implemented as full themed TSX (no placeholders) and covered by a component/RSC test or focused Playwright assertion.

**Depends on: Phases 1–5** (Tailwind `@theme` tokens + `lib/money.ts` from 1; `requireRole`/`getSessionUser` + `proxy.ts` authz from 2; QRPH decode from 3; rail/quote from 4; wallet + payments + qrph API handlers from 5).

**Deliverable:** A working, themed, accessible Payer app: `src/components/ui/*` primitives and `(payer)` layout + dashboard, scan, confirm, prefund, transactions, settings screens, all wired to live `/api/wallet`, `/api/qrph/decode`, `/api/payments/*`, and `/api/auth/password` responses, with Vitest component tests and Playwright assertions green.

---

## Conventions for this phase

- **Test runner:** Vitest + React Testing Library (`@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`) in `jsdom` for component/RSC unit tests; `@playwright/test` for browser-only behavior (camera, scan-line animation, polling overlay). Add `tests/setup.ts` (imports `@testing-library/jest-dom`) and a `vitest.config.ts` project entry with `environment: "jsdom"` for `*.test.tsx` if not already present from Phase 1.
- **TDD rhythm per task:** write the failing test → run (`pnpm test <file>`) and watch it fail → implement the COMPLETE component/screen → run and watch it pass → `pnpm typecheck && pnpm lint` → commit (Conventional Commit, e.g. `feat(payer-ui): hero balance card`).
- **Theming rule (verbatim from Global Constraints):** reference tokens only — `bg-primary`, `text-display-lg`, `rounded-full`, `p-stack-lg`, `text-mono-data`, `gap-stack-lg`. Never hard-code hex/px. Cyan = trust/confirmed; orange (`secondary`) = live/pending/processing. Pills for consumer payment CTAs; `rounded-lg`/`rounded-xl` for data surfaces. XLM primary + PHP human reference, both shown. All financial numerics in `mono-data`.
- **Accessibility (every task):** real `<label>`s; visible focus rings (`focus:ring-4 focus:ring-primary/10`); status conveyed by text+badge not color; tap targets ≥44×44px (`min-h-11 min-w-11` or `py-4`); honor `prefers-reduced-motion` (the global CSS rule disables animations; never gate critical info behind animation).
- **Server/Client boundary (AGENT §4):** screens are RSC by default and fetch via `import "server-only"` data helpers that call the same domain functions the Route Handlers use, OR via `fetch` to the API with the forwarded session cookie. Interactivity (camera, copy, polling, forms) lives in small `"use client"` leaf components. Never import `server/*` secret modules into a Client Component.
- **Money formatting:** always via `lib/money.ts` (`displayXlm`, `displayPhp`, `formatXlm`, `formatPhp`). Never format money inline.
- **API field names** must match the Phase 5 contracts exactly: `GET /api/wallet` → `{publicKey, balanceXlm, reservedXlm, availableXlm, approxPhp}`; `GET /api/wallet/deposit-address` → `{publicKey, qrSvg, network, memoRequired}`; `POST /api/wallet/sync` → `{balanceXlm}`; `GET /api/wallet/transactions?cursor=&limit=` → `{items, nextCursor}`; `POST /api/qrph/decode` → `{decoded, merchant?}`; `POST /api/payments/quote` → `{paymentId, amountPhp, rate, amountXlm, networkFeeXlm, quoteExpiresAt}`; `POST /api/payments/[id]/confirm` → `{paymentId, status}`; `GET /api/payments/[id]` → `{payment, events}`; `POST /api/payments/[id]/cancel` → `{status}`; `POST /api/auth/password` → `204`.

---

## Task 1 — Shared themed UI primitives (`src/components/ui/`)

Build the reusable, token-driven building blocks every Payer screen composes. Do this first so later tasks have no inline styling.

**Files**

- `src/components/ui/Button.tsx`
- `src/components/ui/Card.tsx` (Card + TonalCard)
- `src/components/ui/StatusBadge.tsx`
- `src/components/ui/MoneyAmount.tsx`
- `src/components/ui/Icon.tsx`
- `src/components/ui/GlassHeader.tsx`
- `src/components/ui/index.ts` (barrel)
- Tests: `src/components/ui/StatusBadge.test.tsx`, `src/components/ui/MoneyAmount.test.tsx`, `src/components/ui/Button.test.tsx`

**Interfaces**

- _Consumes:_ `lib/money.ts` (`Decimal`, `displayXlm`, `displayPhp`); BRAND `@theme` tokens; `PaymentStatus` enum from `@/generated/prisma`.
- _Produces (shared, reused by all later tasks):_
  - `Button` props: `{ variant: "primary-pill" | "outline-pill" | "secondary-pill" | "onboarding"; size?: "md" | "lg"; trailingIcon?: string; loading?: boolean } & ButtonHTMLAttributes`.
  - `Card`, `TonalCard` (`{ as?, className?, children }`).
  - `StatusBadge` props: `{ status: PaymentStatus | "SETTLED" | "PENDING" | "FAILED"; label?: string }`.
  - `MoneyAmount` props: `{ xlm: Decimal; php: Decimal; size?: "display" | "md" | "row"; phpPrefix?: string }`.
  - `Icon` props: `{ name: string; filled?: boolean; className?: string; "aria-hidden"?: boolean }`.
  - `GlassHeader` (`{ children }`).

**Steps**

- [ ] Write `StatusBadge.test.tsx`: rendering `status="SETTLED"` shows text "Settled" AND a dot element (`[data-testid="status-dot"]`) — assert the label text is present (status NOT by color alone); `status="PENDING"` shows "Pending" + a dot carrying the `status-pulse` animation class; `status="FAILED"` shows "Failed" in error styling. Run → fail.
- [ ] Write `MoneyAmount.test.tsx`: given `xlm={dec("12.5")}` `php={dec("742.10")}`, the rendered output contains both `"12.5000000 XLM"` and `"₱742.10"`. Run → fail.
- [ ] Write `Button.test.tsx`: `variant="primary-pill"` renders a `<button>` with `rounded-full` class and accessible name; `loading` disables it and exposes `aria-busy="true"`; `trailingIcon="arrow_forward"` renders the icon. Run → fail.
- [ ] Implement `Icon.tsx` — Material Symbols wrapper:
  ```tsx
  import { clsx } from "clsx";

  export function Icon({
    name,
    filled = false,
    className,
    "aria-hidden": ariaHidden = true,
  }: {
    name: string;
    filled?: boolean;
    className?: string;
    "aria-hidden"?: boolean;
  }) {
    return (
      <span
        aria-hidden={ariaHidden}
        className={clsx(
          "material-symbols-outlined select-none",
          filled && "icon-filled",
          className,
        )}
      >
        {name}
      </span>
    );
  }
  ```
  (`.icon-filled { font-variation-settings: 'FILL' 1; }` lives in `globals.css` per BRAND §6; confirm it exists, add if missing.)
- [ ] Implement `Button.tsx` with the three pill variants + onboarding variant from BRAND §7:
  ```tsx
  import { clsx } from "clsx";
  import { forwardRef, type ButtonHTMLAttributes } from "react";
  import { Icon } from "./Icon";

  type Variant = "primary-pill" | "outline-pill" | "secondary-pill" | "onboarding";

  const base =
    "inline-flex items-center justify-center gap-stack-sm font-display font-bold rounded-full " +
    "transition-[filter,transform] focus:outline-none focus:ring-4 focus:ring-primary/10 " +
    "disabled:opacity-60 disabled:pointer-events-none min-h-11";

  const variants: Record<Variant, string> = {
    "primary-pill":
      "bg-primary text-on-primary text-headline-md shadow-lg shadow-primary/20 hover:brightness-110 active:scale-95",
    "outline-pill":
      "border-2 border-primary text-primary text-body-lg bg-transparent hover:bg-primary/5 active:scale-95",
    "secondary-pill":
      "bg-secondary text-on-secondary text-headline-md hover:brightness-110 active:scale-95",
    onboarding: "bg-secondary text-on-secondary text-body-lg hover:-translate-y-[2px]",
  };

  export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant;
    size?: "md" | "lg";
    trailingIcon?: string;
    loading?: boolean;
  }

  export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    {
      variant = "primary-pill",
      size = "lg",
      trailingIcon,
      loading,
      children,
      className,
      disabled,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        className={clsx(
          base,
          variants[variant],
          size === "lg" ? "px-stack-lg py-4" : "px-stack-md py-3",
          className,
        )}
        {...rest}
      >
        {loading && <Icon name="progress_activity" className="animate-spin" />}
        <span>{children}</span>
        {trailingIcon && !loading && <Icon name={trailingIcon} />}
      </button>
    );
  });
  ```
- [ ] Implement `Card.tsx`:
  ```tsx
  import { clsx } from "clsx";
  import type { ElementType, ReactNode } from "react";

  export function Card({
    as: As = "div",
    className,
    children,
  }: {
    as?: ElementType;
    className?: string;
    children: ReactNode;
  }) {
    return (
      <As className={clsx("rounded-xl bg-surface-container-lowest p-stack-lg", className)}>
        {children}
      </As>
    );
  }

  // Cyan-tinted elevation per BRAND §5 via the `.tonal-card` component utility in globals.css.
  export function TonalCard({
    as: As = "div",
    className,
    children,
  }: {
    as?: ElementType;
    className?: string;
    children: ReactNode;
  }) {
    return <As className={clsx("tonal-card rounded-xl p-stack-lg", className)}>{children}</As>;
  }
  ```
- [ ] Implement `StatusBadge.tsx` — text + dot, never color alone (BRAND §7/§8):
  ```tsx
  import { clsx } from "clsx";
  import type { PaymentStatus } from "@/generated/prisma";

  type Tone = "settled" | "pending" | "failed";
  const TONE: Record<Tone, { chip: string; dot: string; pulse?: boolean }> = {
    settled: { chip: "bg-primary/10 text-primary", dot: "bg-primary" },
    pending: { chip: "bg-secondary/10 text-secondary", dot: "bg-secondary", pulse: true },
    failed: { chip: "bg-error/10 text-error", dot: "bg-error" },
  };

  // Map every PaymentStatus to a tone + human label.
  function classify(status: string): { tone: Tone; label: string } {
    if (status === "SETTLED") return { tone: "settled", label: "Settled" };
    if (status === "FAILED") return { tone: "failed", label: "Failed" };
    if (status === "REFUNDED") return { tone: "settled", label: "Refunded" };
    return { tone: "pending", label: "Pending" }; // CREATED..PAYOUT_SUBMITTED, REFUND_PENDING
  }

  export function StatusBadge({
    status,
    label,
  }: {
    status: PaymentStatus | "SETTLED" | "PENDING" | "FAILED";
    label?: string;
  }) {
    const c = classify(status);
    const tone = TONE[c.tone];
    return (
      <span
        className={clsx(
          "inline-flex items-center gap-stack-sm rounded-full px-3 py-1 text-label-md uppercase",
          tone.chip,
        )}
      >
        <span
          data-testid="status-dot"
          aria-hidden
          className={clsx(
            "h-1.5 w-1.5 rounded-full",
            tone.dot,
            tone.pulse && "animate-status-pulse",
          )}
        />
        {label ?? c.label}
      </span>
    );
  }
  ```
  (Ensure `globals.css` defines `@keyframes status-pulse` + `.animate-status-pulse` per BRAND §5; add if Phase 1 didn't.)
- [ ] Implement `MoneyAmount.tsx` — XLM primary + PHP reference beneath (BRAND §10):
  ```tsx
  import { clsx } from "clsx";
  import { type Decimal, displayPhp, displayXlm } from "@/lib/money";

  export function MoneyAmount({
    xlm,
    php,
    size = "md",
    phpPrefix = "≈",
  }: {
    xlm: Decimal;
    php: Decimal;
    size?: "display" | "md" | "row";
    phpPrefix?: string;
  }) {
    const xlmCls =
      size === "display"
        ? "text-display-lg text-primary"
        : size === "row"
          ? "text-mono-data"
          : "text-headline-md text-primary font-mono";
    const phpCls =
      size === "display"
        ? "text-headline-md text-on-surface-variant"
        : "text-body-sm text-on-surface-variant";
    return (
      <div className={clsx(size === "row" ? "flex flex-col items-end" : "flex flex-col")}>
        <span className={clsx("font-mono", xlmCls)}>{displayXlm(xlm)}</span>
        <span className={phpCls}>
          {phpPrefix} {displayPhp(php)}
        </span>
      </div>
    );
  }
  ```
- [ ] Implement `GlassHeader.tsx` (consumer top nav shell, BRAND §7): `glass` utility, brand lockup = filled `account_balance_wallet` in `primary` + "HeyPay" wordmark (`text-headline-md font-bold text-primary`), right slot for children.
  ```tsx
  import type { ReactNode } from "react";
  import { Icon } from "./Icon";

  export function GlassHeader({ children }: { children?: ReactNode }) {
    return (
      <header className="glass sticky top-0 z-40 flex h-16 items-center justify-between px-margin-mobile lg:px-margin-desktop">
        <a
          href="/payer/dashboard"
          className="flex items-center gap-stack-sm focus:outline-none focus:ring-4 focus:ring-primary/10 rounded-lg"
        >
          <Icon name="account_balance_wallet" filled className="text-primary text-3xl" />
          <span className="font-display text-headline-md font-bold text-primary">HeyPay</span>
        </a>
        <div className="flex items-center gap-stack-md">{children}</div>
      </header>
    );
  }
  ```
- [ ] Add `index.ts` barrel exporting all primitives. Run all three tests → green. `pnpm typecheck && pnpm lint`. Commit `feat(payer-ui): shared themed UI primitives`.

---

## Task 2 — Payer layout & navigation (`(payer)/layout.tsx`)

Role-guarded shell with desktop SideNav (`w-64`, `lg+`) and mobile bottom nav (`h-16`), "Scan to Pay" primary action, Support/Logout footer (logout in `error`).

**Files**

- `src/app/(payer)/layout.tsx` (RSC; `requireRole(PAYER)`)
- `src/components/payer/SideNav.tsx` (`"use client"` for active-route highlighting)
- `src/components/payer/MobileNav.tsx` (`"use client"`)
- `src/components/payer/nav-items.ts` (shared nav config)
- Tests: `src/components/payer/SideNav.test.tsx`, `src/components/payer/MobileNav.test.tsx`

**Interfaces**

- _Consumes:_ `requireRole` from `@/server/auth/sessions`; `Role.PAYER`; `Button`, `Icon` from `ui`; `usePathname` (next/navigation).
- _Produces:_ `(payer)` layout used by all Payer screens; `PAYER_NAV_ITEMS` config.

**Steps**

- [ ] Write `SideNav.test.tsx`: render with `usePathname` mocked to `/payer/dashboard`; assert the Dashboard item has `aria-current="page"` and the active classes (`bg-primary-container`); Logout link text is present and carries the error color class; the "Scan to Pay" button is a primary pill linking to `/payer/scan`. Run → fail.
- [ ] Write `MobileNav.test.tsx`: assert it renders 4 nav links, each ≥44px tap target (`min-h-11`), a centered "Scan to Pay" FAB, and is hidden on `lg` (`lg:hidden`). Run → fail.
- [ ] Implement `nav-items.ts`:
  ```ts
  export const PAYER_NAV_ITEMS = [
    { href: "/payer/dashboard", label: "Dashboard", icon: "dashboard" },
    { href: "/payer/transactions", label: "History", icon: "history" },
    { href: "/payer/prefund", label: "Prefund", icon: "add_circle" },
    { href: "/payer/settings", label: "Settings", icon: "settings" },
  ] as const;
  ```
- [ ] Implement `SideNav.tsx` (BRAND §7 side nav): `surface-container-low`, `w-64`, fixed; brand title in `primary`; nav items active = `bg-primary-container text-on-primary-container font-bold` (filled icon), inactive = `text-on-surface-variant hover:bg-surface-container-high`; primary "Scan to Pay" pill (`<Button variant="primary-pill">` wrapping a Link, trailing `qr_code_scanner`); footer Support link (`support_agent`) + Logout (`<a href="/logout">` text `text-error`). Each item `min-h-11`, `focus:ring-4 focus:ring-primary/10`, `aria-current` when active.
- [ ] Implement `MobileNav.tsx` (BRAND §4): fixed bottom bar `h-16`, `glass` or `surface-container-low`, `lg:hidden`; 4 items with icon+label (`text-label-md`), active = `text-primary` + filled icon; a raised center "Scan to Pay" FAB (`rounded-full bg-primary` `h-14 w-14`, ≥44px) linking `/payer/scan` with `qr_code_scanner`; `aria-label` on the FAB.
- [ ] Implement `(payer)/layout.tsx`:
  ```tsx
  import "server-only";
  import { Role } from "@/generated/prisma";
  import { requireRole } from "@/server/auth/sessions";
  import { SideNav } from "@/components/payer/SideNav";
  import { MobileNav } from "@/components/payer/MobileNav";

  export default async function PayerLayout({ children }: { children: React.ReactNode }) {
    const user = await requireRole(Role.PAYER); // throws forbidden() handled by proxy/error boundary
    return (
      <div className="min-h-dvh bg-background text-on-background">
        <SideNav username={user.username} />
        <main className="lg:ml-64 px-margin-mobile lg:px-margin-desktop pb-24 lg:pb-margin-desktop pt-stack-lg">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
        <MobileNav />
      </div>
    );
  }
  ```
- [ ] Run nav tests → green. `pnpm typecheck && pnpm lint`. Commit `feat(payer-ui): payer layout with side + mobile nav`.

---

## Task 3 — `/payer/dashboard`

Hero balance card, Prefund/Send pill CTAs, solid-primary Scan QRPH card with inner orange Start button, recent payments list, prefund panel (address + QR + copy), network status. Server-rendered from `GET /api/wallet` + recent payments; balance polled/refreshed client-side.

**Files**

- `src/app/(payer)/payer/dashboard/page.tsx` (RSC)
- `src/components/payer/HeroBalanceCard.tsx` (server-rendered shell + `"use client"` balance refresher)
- `src/components/payer/BalanceLive.tsx` (`"use client"` — polls `GET /api/wallet`)
- `src/components/payer/ScanQrphCard.tsx`
- `src/components/payer/RecentPaymentsList.tsx`
- `src/components/payer/PrefundPanel.tsx` (`"use client"` — copy button + QR)
- `src/components/payer/NetworkStatus.tsx`
- `src/server/payer/data.ts` (`import "server-only"` data helpers)
- Tests: `src/components/payer/HeroBalanceCard.test.tsx`, `src/components/payer/RecentPaymentsList.test.tsx`, Playwright `tests/e2e/payer-dashboard.spec.ts`

**Interfaces**

- _Consumes:_ `GET /api/wallet` → `{publicKey, balanceXlm, reservedXlm, availableXlm, approxPhp}`; `GET /api/wallet/deposit-address` → `{publicKey, qrSvg, network, memoRequired}`; recent payments via a server helper `getRecentPayments(payerId, limit)` returning `{id, reference, merchantName, amountXlm, amountPhp, status, createdAt}[]`; `MoneyAmount`, `StatusBadge`, `Button`, `Card`, `TonalCard`, `Icon`.
- _Produces:_ `getWalletSummary()`, `getRecentPayments()` server helpers reused by transactions/confirm.

**Steps**

- [ ] Write `HeroBalanceCard.test.tsx`: given `availableXlm=dec("250")`, `approxPhp=dec("14850.00")`, the card shows `display-lg` XLM in primary and `≈ ₱14,850.00`, plus a filled "Prefund" pill and an outlined "Send" pill. Run → fail.
- [ ] Write `RecentPaymentsList.test.tsx`: given two payments (one `SETTLED`, one `PDAX_TRADING`), each row shows merchant name, `MoneyAmount` (XLM + PHP), a `StatusBadge` with the correct label, and a date; empty array renders an empty-state with a "Scan to Pay" CTA. Run → fail.
- [ ] Write Playwright `payer-dashboard.spec.ts` (mock-rail seeded payer): after login, dashboard shows a balance figure, the "Scan QRPH" card, and at least the prefund address; assert no layout shift and balance text is visible. Run → fail (page not built).
- [ ] Implement `src/server/payer/data.ts` — `getWalletSummary()` (fetches via the same domain function the `/api/wallet` handler uses, or `fetch(APP_URL + "/api/wallet", { headers: forwardedCookie })`), and `getRecentPayments()` (Prisma read scoped to `payerId`, ownership-checked). Returns `Decimal`-typed amounts; mark `import "server-only"`.
- [ ] Implement `HeroBalanceCard.tsx` (BRAND §7 hero): white `TonalCard` `rounded-xl` with a blurred `bg-primary/5` decorative blob (`absolute -top-10 -right-10 h-40 w-40 rounded-full blur-3xl`), `display-lg` figure in `primary` via `<MoneyAmount size="display">`, label-md eyebrow "TOTAL BALANCE", and paired CTAs: `<Button variant="primary-pill" trailingIcon="add_circle">Prefund</Button>` (Link `/payer/prefund`) + `<Button variant="outline-pill" trailingIcon="send">Send</Button>` (Link `/payer/scan`). Wrap the figure in `<BalanceLive initial={...}>` so it updates.
- [ ] Implement `BalanceLive.tsx` (`"use client"`): polls `GET /api/wallet` every ~15s (and on focus) with `fetch`, parses amounts through `dec()`, re-renders `<MoneyAmount>`; uses `AbortController` cleanup; no animation (reduced-motion safe — it's a data update, not a decorative animation).
- [ ] Implement `ScanQrphCard.tsx` (BRAND §7 scan CTA): solid `bg-primary text-on-primary rounded-xl p-stack-lg`, large `qr_code_scanner` icon, heading "Scan QRPH", body "Pay any QRPH merchant instantly", inner orange Start button `<Button variant="secondary-pill" trailingIcon="arrow_forward">Start Payment</Button>` linking `/payer/scan`.
- [ ] Implement `RecentPaymentsList.tsx`: `Card` titled "Recent Payments" (`headline-md`) with a "View all" link → `/payer/transactions`; rows = merchant name + city, `<MoneyAmount size="row">`, `<StatusBadge status={p.status}>`, and a localized date (`body-sm text-on-surface-variant`); divider `divide-y divide-outline-variant`; empty state with `history` icon + "No payments yet" + Scan CTA.
- [ ] Implement `PrefundPanel.tsx` (`"use client"`): `Card` showing the custodial `publicKey` in `mono-data` truncated with ellipsis, the `qrSvg` (rendered via `dangerouslySetInnerHTML` of the server-provided trusted SVG, or an `<img>`), a copy button (`content_copy` icon, ≥44px, `aria-live="polite"` "Copied!" confirmation), and the reminder "Stellar network · no memo required". Links to full `/payer/prefund`.
- [ ] Implement `NetworkStatus.tsx`: small inline row, `hub` icon, label "Stellar Testnet" (from a public config value), a `primary` dot meaning connected (text "Connected" — not color alone).
- [ ] Implement `dashboard/page.tsx` (RSC) composing a bento grid (`grid-cols-1 lg:grid-cols-3 gap-stack-lg`): hero (span 2) + Scan card; recent payments (span 2) + prefund panel; network status row. Fetch data via `getWalletSummary`/`getRecentPayments` in parallel (`Promise.all`).
- [ ] Run component tests + Playwright → green. `pnpm typecheck && pnpm lint`. Commit `feat(payer-ui): dashboard`.

---

## Task 4 — `/payer/scan`

Camera scan (`getUserMedia`, requires `Permissions-Policy: camera` on this route from `proxy.ts`) AND image upload, both with a scan-line animation; decode client-side then `POST /api/qrph/decode`; route to confirm or show "merchant not registered" empty state.

**Files**

- `src/app/(payer)/payer/scan/page.tsx` (RSC shell + intro copy)
- `src/components/payer/Scanner.tsx` (`"use client"` — camera + upload + decode)
- `src/components/payer/ScanFrame.tsx` (the framed viewport + animated scan line)
- `src/components/payer/MerchantNotRegistered.tsx` (empty state)
- `src/components/payer/AmountPrompt.tsx` (`"use client"` — prompt PHP amount when QR is static / no tag 54)
- Tests: `src/components/payer/MerchantNotRegistered.test.tsx`, Playwright `tests/e2e/payer-scan.spec.ts`

**Interfaces**

- _Consumes:_ `decodeQrphImage`/`decodeQrph` are server-side (Phase 3); the client decodes with `jsqr`/`@zxing/library` to a raw string then `POST /api/qrph/decode {raw}` → `{decoded, merchant?}`; on `merchant` present + dynamic amount → `POST /api/payments/quote {merchantId, amountPhp}` → `{paymentId}` then `router.push(/payer/pay/${paymentId}/confirm)`; on static QR → show `AmountPrompt` first. `Button`, `Card`, `Icon`.
- _Produces:_ none shared.

**Steps**

- [ ] Confirm `proxy.ts` (Phase 2) sets `Permissions-Policy: camera=(self)` ONLY for `/payer/scan` (camera disabled elsewhere per AGENT §6). If absent, add a note/TODO to coordinate — the camera path needs it. (This is a hard dependency; verify in the test.)
- [ ] Write `MerchantNotRegistered.test.tsx`: renders the empty state with heading "Merchant not registered", explanatory body, and a "Scan again" button + "Back to dashboard" link. Run → fail.
- [ ] Write Playwright `payer-scan.spec.ts`: visit `/payer/scan`; assert the scan frame, an "Upload image" control, and a "Use camera" control are present; uploading a fixture QR image (a registered demo merchant's QRPH PNG) triggers a `POST /api/qrph/decode` (route-intercept assertion) and navigates toward confirm. Use Playwright `route` interception to stub `/api/qrph/decode` returning `{decoded, merchant}` and `/api/payments/quote` returning `{paymentId:"pay_1"}`; assert URL becomes `/payer/pay/pay_1/confirm`. Run → fail.
- [ ] Implement `ScanFrame.tsx`: a square framed viewport (`aspect-square rounded-xl border-2 border-primary/30 overflow-hidden`) containing either the `<video>` (camera) or the uploaded `<img>`, with corner brackets and an animated scan line `<div className="absolute inset-x-0 h-0.5 bg-primary/70 animate-scan" />` (BRAND `scan` keyframes top 0→100%, disabled under reduced-motion by the global rule).
- [ ] Implement `Scanner.tsx` (`"use client"`):
  - Tab/toggle between "Use camera" and "Upload image".
  - Camera: `navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })`, attach to `<video>`, run a decode loop with `requestAnimationFrame` + `jsqr` on a canvas frame; on permission denial show an accessible fallback prompting upload (no reliance on color). Always stop tracks on unmount.
  - Upload: `<input type="file" accept="image/*">` with a real `<label>` (≥44px), decode the image to raw via the QR lib.
  - On raw string: `POST /api/qrph/decode {raw}`. If `merchant` null → render `<MerchantNotRegistered />`. If `decoded.amountPhp` present (dynamic) → immediately `POST /api/payments/quote` then push to confirm. If absent (static) → render `<AmountPrompt>` to collect PHP, then quote → push.
  - Loading + error states use text + `Icon`, not color alone; errors via the standard envelope message.
- [ ] Implement `AmountPrompt.tsx`: a single PHP amount input (real `<label>`, `inputMode="decimal"`, `mono-data`), validation (positive, ≤2dp), and a primary pill "Continue" (`trailingIcon="arrow_forward"`).
- [ ] Implement `MerchantNotRegistered.tsx`: `Card` empty state, `error`-tinted `lock`/`error` icon, heading + body, "Scan again" (`Button outline-pill`) + dashboard link.
- [ ] Implement `scan/page.tsx`: RSC shell with title "Scan to Pay" (`headline-lg`/`headline-lg-mobile`), short reassuring copy, then `<Scanner />`, centered `max-w-lg`.
- [ ] Run tests → green. `pnpm typecheck && pnpm lint`. Commit `feat(payer-ui): scan (camera + upload)`.

---

## Task 5 — `/payer/pay/[paymentId]/confirm` + processing overlay

Confirm screen with live PDAX conversion, then Confirm → processing overlay polling `GET /api/payments/[id]` through the state machine; on `SETTLED` the headline flips to `secondary` with a Done button.

**Files**

- `src/app/(payer)/payer/pay/[paymentId]/confirm/page.tsx` (RSC — loads the quoted payment)
- `src/components/payer/ConfirmPayment.tsx` (`"use client"` — confirm action + overlay orchestration)
- `src/components/payer/ConversionBreakdown.tsx` (rate, total XLM deduction, network fee)
- `src/components/payer/WalletSourceRow.tsx`
- `src/components/payer/ProcessingOverlay.tsx` (`"use client"` — spinner + pulse-ring + step checklist)
- `src/lib/payment-steps.ts` (status → ordered checklist mapping)
- Tests: `src/components/payer/ConversionBreakdown.test.tsx`, `src/components/payer/ProcessingOverlay.test.tsx`, Playwright `tests/e2e/payer-pay.spec.ts`

**Interfaces**

- _Consumes:_ `GET /api/payments/[id]` → `{payment, events}` where `payment` includes `{id, reference, amountPhp, quotedRate, amountXlm, networkFeeXlm, status, merchant:{businessName, qrphMerchantCity}, quoteExpiresAt}`; `POST /api/payments/[id]/confirm {}` + `Idempotency-Key` → `{paymentId, status}`; `POST /api/payments/[id]/cancel` → `{status}`; `GET /api/wallet` (source balance); `MoneyAmount`, `Button`, `Card`, `Icon`, `StatusBadge`.
- _Produces:_ `PAYMENT_STEPS` checklist config (reused conceptually by admin timeline in Phase 8 — note in self-review, not exported across phases).

**Steps**

- [ ] Write `ConversionBreakdown.test.tsx`: given `amountPhp=dec("500.00")`, `quotedRate=dec("59.40")`, `amountXlm=dec("8.4175084")`, `networkFeeXlm=dec("0.00001")`, the component shows the requested PHP prominently, the rate `1 XLM = ₱59.40` in `mono-data`, the network fee in `mono-data`, and the total XLM deduction (`amountXlm + networkFeeXlm`) computed via `lib/money`. Run → fail.
- [ ] Write `ProcessingOverlay.test.tsx`: given `status="PDAX_TRADING"`, the checklist shows completed steps with `check_circle` and the in-progress step with `sync` (+ pulse class); given `status="SETTLED"`, the headline carries the `secondary` color class, shows the success copy "₱500.00 sent to {merchant}", and a "Done" button is present. Run → fail.
- [ ] Write Playwright `payer-pay.spec.ts` (mock rail end-to-end OR route-stubbed): land on confirm with a seeded `QUOTED` payment; assert merchant, requested PHP, rate, total XLM, network fee, and the wallet source row render; click Confirm → overlay appears with `aria-live` status; stub `GET /api/payments/[id]` to advance `AUTHORIZED → … → SETTLED`; assert the overlay reaches the success headline and Done routes to `/payer/transactions`. Run → fail.
- [ ] Implement `lib/payment-steps.ts`:
  ```ts
  import type { PaymentStatus } from "@/generated/prisma";

  export const PAYMENT_STEPS: { key: PaymentStatus; label: string }[] = [
    { key: "AUTHORIZED", label: "Payment authorized" },
    { key: "STELLAR_SUBMITTED", label: "Sending XLM on Stellar" },
    { key: "STELLAR_CONFIRMED", label: "XLM confirmed on-chain" },
    { key: "PDAX_TRADING", label: "Converting XLM → PHP" },
    { key: "PDAX_TRADED", label: "PHP received" },
    { key: "PAYOUT_SUBMITTED", label: "Paying out to merchant bank" },
    { key: "SETTLED", label: "Settled" },
  ];

  const ORDER = PAYMENT_STEPS.map((s) => s.key);
  export function stepState(
    stepKey: PaymentStatus,
    current: PaymentStatus,
  ): "done" | "active" | "todo" {
    if (current === "FAILED" || current === "REFUND_PENDING" || current === "REFUNDED") {
      return ORDER.indexOf(stepKey) < ORDER.indexOf("STELLAR_SUBMITTED") ? "done" : "todo";
    }
    const ci = ORDER.indexOf(current);
    const si = ORDER.indexOf(stepKey);
    if (si < ci) return "done";
    if (si === ci) return current === "SETTLED" ? "done" : "active";
    return "todo";
  }
  ```
- [ ] Implement `ConversionBreakdown.tsx`: `Card` with requested PHP big (`headline-lg`), a `divide-y divide-outline-variant` list of rows — "Exchange rate" `1 XLM = ₱{rate}` (`mono-data`), "Network fee" `displayXlm(networkFeeXlm)`, and a bold "Total deduction" row `<MoneyAmount xlm={amountXlm.plus(networkFeeXlm)} php={amountPhp} size="row">`. All numerics `mono-data`.
- [ ] Implement `WalletSourceRow.tsx` (BRAND §7 "Pay From"): `surface-container-highest rounded-lg` row, `account_balance_wallet` icon, "HeyPay Wallet" label, truncated `publicKey` (`mono-data`), and available balance via `<MoneyAmount size="row">`; if available < total, show an inline `error` text "Insufficient balance" + Prefund link (text, not color alone).
- [ ] Implement `ProcessingOverlay.tsx` (BRAND §7 processing overlay):
  - Full-screen `fixed inset-0 bg-surface/95 backdrop-blur-md` with `role="dialog" aria-modal="true" aria-live="polite"`.
  - Concentric spinner: outer `border-t-4 border-primary rounded-full animate-spin` + inner `animate-pulse-ring` ring (BRAND `pulse-ring`).
  - Step checklist from `PAYMENT_STEPS` + `stepState`: done → `check_circle` (filled, `primary`); active → `sync` (`secondary`) + `animate-pulse`; todo → muted `radio_button_unchecked`. Each row has the text label (status by text+icon, not color alone).
  - On `SETTLED`: swap spinner for a large `secondary` `check_circle`, headline `text-secondary` "₱{php} sent to {merchant}", and `<Button variant="secondary-pill">Done</Button>` → `/payer/transactions`.
  - On `FAILED`/`REFUND_PENDING`: `error` icon + `failureReason` + "Back" / "Try again".
- [ ] Implement `ConfirmPayment.tsx` (`"use client"`): renders `ConversionBreakdown` + `WalletSourceRow` + Confirm pill (`primary-pill`, `trailingIcon="lock"`, disabled if quote expired or insufficient) + Cancel (`outline-pill`, calls `POST cancel`). Quote-expiry countdown from `quoteExpiresAt` (text); when expired, disable Confirm and show "Quote expired — rescan". On Confirm: generate an `Idempotency-Key` (`crypto.randomUUID()`), `POST /api/payments/[id]/confirm`, mount `<ProcessingOverlay>`, and poll `GET /api/payments/[id]` (~2s interval, `AbortController`, backoff, stop on terminal status). Prefer SSE `/api/payments/[id]/stream` if available, else poll.
- [ ] Implement `confirm/page.tsx` (RSC): load the payment via server helper (ownership-checked: payer owns it; 404/forbidden otherwise), pass `QUOTED` snapshot + merchant + wallet summary into `<ConfirmPayment>`; centered `max-w-lg`; title "Confirm Payment", merchant info block (`businessName` `headline-md`, city, optional logo). Anti-clickjacking relies on `X-Frame-Options: DENY` from `proxy.ts`.
- [ ] Run tests → green. `pnpm typecheck && pnpm lint`. Commit `feat(payer-ui): confirm + processing overlay`.

---

## Task 6 — `/payer/prefund`

Custodial deposit address + QR, Stellar/no-memo reminder, pending-deposit detection by polling `POST /api/wallet/sync`.

**Files**

- `src/app/(payer)/payer/prefund/page.tsx` (RSC — loads deposit address)
- `src/components/payer/DepositCard.tsx` (`"use client"` — copy + QR)
- `src/components/payer/PendingDepositWatcher.tsx` (`"use client"` — polls sync)
- Tests: `src/components/payer/DepositCard.test.tsx`, Playwright `tests/e2e/payer-prefund.spec.ts`

**Interfaces**

- _Consumes:_ `GET /api/wallet/deposit-address` → `{publicKey, qrSvg, network, memoRequired}`; `POST /api/wallet/sync` → `{balanceXlm}`; `GET /api/wallet` for current balance; `Card`, `Button`, `Icon`, `MoneyAmount`.
- _Produces:_ none shared.

**Steps**

- [ ] Write `DepositCard.test.tsx`: shows the full `publicKey` (selectable, `mono-data`), a copy button (`content_copy`, ≥44px) that on click writes to clipboard and announces "Address copied" via `aria-live`, the network reminder text "Stellar network · No memo required", and renders the provided `qrSvg`. Run → fail.
- [ ] Write Playwright `payer-prefund.spec.ts`: visit `/payer/prefund`; assert address, QR, and reminder render; stub `POST /api/wallet/sync` to return an increased `balanceXlm` and assert the page surfaces a "Deposit detected" confirmation (text, not color alone). Run → fail.
- [ ] Implement `DepositCard.tsx` (`"use client"`): `Card` titled "Prefund your wallet"; QR frame (`rounded-xl border border-outline-variant p-stack-md`, `qrSvg` via trusted SVG); address row with copy; explicit reminder block using `body-sm` (warning conveyed by `Icon` + text, never orange small text per BRAND §8): `Icon name="info"` + "Send only XLM on the Stellar network. No memo is required." Show base-reserve note: "Send at least 1 XLM to activate your account."
- [ ] Implement `PendingDepositWatcher.tsx` (`"use client"`): polls `POST /api/wallet/sync` every ~10s; compares returned `balanceXlm` to the initial; on increase, shows a `primary`-toned banner with `check_circle` + "Deposit detected: +{displayXlm(delta)}" (`aria-live="polite"`) and a "Go to dashboard" pill. Stops polling on detection; `AbortController` cleanup; reduced-motion safe.
- [ ] Implement `prefund/page.tsx` (RSC): centered `max-w-lg`, title "Prefund Account" (`headline-lg`/mobile), current balance via `<MoneyAmount>`, `<DepositCard>` (server-fetched deposit address), `<PendingDepositWatcher initialBalance={...}>`.
- [ ] Run tests → green. `pnpm typecheck && pnpm lint`. Commit `feat(payer-ui): prefund`.

---

## Task 7 — `/payer/transactions`

Personal history list (XLM debited + PHP, merchant, status badge, date) with cursor pagination and a per-tx detail drawer.

**Files**

- `src/app/(payer)/payer/transactions/page.tsx` (RSC — first page)
- `src/components/payer/TransactionList.tsx` (`"use client"` — load-more + drawer)
- `src/components/payer/TransactionRow.tsx`
- `src/components/payer/TransactionDrawer.tsx` (`"use client"`)
- Tests: `src/components/payer/TransactionRow.test.tsx`, `src/components/payer/TransactionList.test.tsx`, Playwright `tests/e2e/payer-transactions.spec.ts`

**Interfaces**

- _Consumes:_ **No REST list endpoint exists for payer payments** (Phase 5 / SPEC §6 expose only `GET /api/payments/[id]` and the wallet ledger `GET /api/wallet/transactions`). This page is server-rendered, so read the payer's payment history via a **server-side Prisma helper** in `src/server/payer/data.ts` (`import "server-only"`), and page it with a **Server Action** — do **not** invent a `GET /api/payments` route. The drawer uses the existing `GET /api/payments/[id]` → `{payment, events}`. Also: `MoneyAmount`, `StatusBadge`, `Card`, `Button`, `Icon`.
  - `getPayerPayments(payerId: string, opts: { cursor?: string; limit: number }): Promise<{ items: PayerPaymentListItem[]; nextCursor?: string }>` — Prisma read scoped + ownership-checked to `payerId`, cursor-paginated by `createdAt`/`id`.
  - `type PayerPaymentListItem = { id: string; reference: string; merchantName: string; merchantCity?: string; amountXlm: string; amountPhp: string; status: PaymentStatus; createdAt: string }` (amounts pre-formatted via `displayXlm`/`displayPhp`; status from `@/generated/prisma`).
  - `"use server"` action `loadMorePayerPayments(cursor: string): Promise<{ items: PayerPaymentListItem[]; nextCursor?: string }>` — calls `requireRole(PAYER)` then `getPayerPayments(user.id, { cursor, limit: 20 })`.
- _Produces:_ `getPayerPayments` + `loadMorePayerPayments` + `PayerPaymentListItem` in `src/server/payer/data.ts` (extends the file created in Task 3).

**Steps**

- [ ] Write `TransactionRow.test.tsx`: a row shows merchant name + city, `<MoneyAmount>` (XLM debited bold + PHP beneath), a `<StatusBadge>` with correct label, a formatted date, and is a button/link opening the drawer (`aria-haspopup` / `aria-expanded`). Run → fail.
- [ ] Write `TransactionList.test.tsx`: renders initial items; "Load more" appears only when `nextCursor` present; clicking it invokes the injected `loadMore` action (mock the `loadMorePayerPayments` server action via a prop) and appends rows; empty state when no items. Run → fail.
- [ ] Write Playwright `payer-transactions.spec.ts`: visit page; assert list renders; click a row → drawer opens showing reference (`mono-data`), the full conversion breakdown, the `PaymentEvent` timeline (status + timestamps), and a close control (Esc + button; focus trapped). Run → fail.
- [ ] Implement `TransactionRow.tsx`: `<button>`/list-item, `min-h-11`, `divide-y divide-outline-variant`, hover `bg-surface-container-high`, `focus:ring-4`; left = merchant, right = `<MoneyAmount size="row">` + `<StatusBadge>`; date in `body-sm text-on-surface-variant`.
- [ ] Implement `TransactionDrawer.tsx` (`"use client"`): right-side drawer (`fixed inset-y-0 right-0 w-full max-w-md bg-surface-container-lowest`) `role="dialog" aria-modal="true"` with focus trap, Esc-to-close, backdrop click close; content = reference (`mono-data`), merchant block, `ConversionBreakdown` (reuse from Task 5), `WalletSourceRow`, and the event timeline (each `PaymentEvent` as a row with `StatusBadge` + timestamp). `stellarTxHash`/refs in `mono-data` truncated with copy.
- [ ] Extend `src/server/payer/data.ts` with `getPayerPayments(payerId, {cursor, limit})` (Prisma `payment.findMany` where `payerId`, `take: limit+1`, cursor by `id` ordered `createdAt desc`, mapping each row to `PayerPaymentListItem` with `displayXlm`/`displayPhp` and `merchant.businessName`/`qrphMerchantCity`) and the `"use server"` action `loadMorePayerPayments(cursor)` that does `requireRole(PAYER)` then returns `getPayerPayments(user.id, {cursor, limit: 20})`. `import "server-only"` on the data helper.
- [ ] Implement `TransactionList.tsx` (`"use client"`): holds items + `nextCursor` state; "Load more" pill (`outline-pill`) calls the `loadMore` action prop (`loadMorePayerPayments`) and appends the returned `items`/`nextCursor`; opens `TransactionDrawer` with the selected id (which fetches `GET /api/payments/[id]`); loading/error states by text.
- [ ] Implement `transactions/page.tsx` (RSC): `requireRole(PAYER)`; title "Transactions" (`headline-lg`/mobile); server-fetch first page via `getPayerPayments(user.id, {limit: 20})`; render `<TransactionList initial={...} loadMore={loadMorePayerPayments}>` inside a `Card`. Empty state with `history` icon + Scan CTA.
- [ ] Run tests → green. `pnpm typecheck && pnpm lint`. Commit `feat(payer-ui): transactions + detail drawer`.

---

## Task 8 — `/payer/settings`

Profile display + change password (calls `POST /api/auth/password`).

**Files**

- `src/app/(payer)/payer/settings/page.tsx` (RSC — profile)
- `src/components/payer/ChangePasswordForm.tsx` (`"use client"`)
- `src/components/payer/ProfileCard.tsx`
- Tests: `src/components/payer/ChangePasswordForm.test.tsx`, Playwright `tests/e2e/payer-settings.spec.ts`

**Interfaces**

- _Consumes:_ `getSessionUser()` for `{username, role}`; `POST /api/auth/password {currentPassword, newPassword}` → `204` (+ error envelope on failure); CSRF same-origin enforced server-side; `Card`, `Button`, `Icon`.
- _Produces:_ none shared.

**Steps**

- [ ] Write `ChangePasswordForm.test.tsx`: three real-`<label>` password fields (current, new, confirm); submitting with mismatched new/confirm shows an inline validation error (text); a successful `204` (mocked fetch) clears fields and shows an `aria-live` success message; a `400`/`401` envelope shows the server message (generic, non-enumerable). Run → fail.
- [ ] Write Playwright `payer-settings.spec.ts`: visit `/payer/settings`; assert username + role display; fill the password form and submit against a stubbed `204`; assert success message; assert client-side mismatch validation blocks submit. Run → fail.
- [ ] Implement `ProfileCard.tsx`: `Card` showing avatar (initial), `username` (`headline-md`), role chip ("Payer"), and account status. Read-only (no profile edit in scope).
- [ ] Implement `ChangePasswordForm.tsx` (`"use client"`): `Card` titled "Change Password"; floating-label inputs (BRAND §7 `peer` pattern) with `type="password"`, real labels, `autoComplete` (`current-password`/`new-password`); client validation (new ≥ min length, new === confirm); on submit `POST /api/auth/password` with same-origin credentials; disable while `loading` (`aria-busy`); success/error via `aria-live` text. Submit = `<Button variant="primary-pill" trailingIcon="lock">Update password</Button>`. Min-length helper text in `body-sm`.
- [ ] Implement `settings/page.tsx` (RSC): title "Settings" (`headline-lg`/mobile), `max-w-2xl`, `<ProfileCard user={await getSessionUser()}>` + `<ChangePasswordForm />`. Footer (BRAND §7): `lock` + "END-TO-END ENCRYPTED" eyebrow + configurable regulatory line (e.g. from a public config: "HeyPay v2.4.0 • Licensed by BSP").
- [ ] Run tests → green. `pnpm typecheck && pnpm lint`. Commit `feat(payer-ui): settings + change password`.

---

## Self-Review

**SPEC §5 Payer routes → tasks**

- `/payer/dashboard` (balance, Prefund/Send, Scan CTA, recent payments, prefund panel, network status) → **Task 3**.
- `/payer/scan` (camera + upload, decode, resolve, route to confirm, not-registered state) → **Task 4**.
- `/payer/pay/[paymentId]/confirm` (merchant info, requested PHP, live conversion, wallet source, Confirm/Cancel, processing overlay → success) → **Task 5**.
- `/payer/prefund` (address + QR, no-memo reminder, pending-deposit detection) → **Task 6**.
- `/payer/transactions` (XLM+PHP, merchant, status, date, detail drawer, pagination) → **Task 7**.
- `/payer/settings` (profile, change password) → **Task 8**.
- The `(payer)` shell + `requireRole(PAYER)` + SideNav/MobileNav → **Task 2**.

**BRAND components → tasks**

- Top nav (glass header, brand lockup) → Task 1 (`GlassHeader`) / Task 2.
- Side nav (`w-64`, active `primary-container`, Scan-to-Pay, Support/Logout-in-error) → Task 2.
- Mobile bottom nav (`h-16`, FAB ≥44px) → Task 2.
- Hero balance card (`display-lg` primary + ≈PHP, pill CTAs, decorative blob) → Task 3.
- Scan QRPH CTA (solid primary card, inner orange Start) → Task 3.
- Buttons (primary pill / outline pill / secondary / onboarding) → Task 1 (`Button`).
- Status badges (text + dot, settled=primary, pending=secondary+status-pulse) → Task 1 (`StatusBadge`).
- Money pairing (XLM mono primary + PHP reference) → Task 1 (`MoneyAmount`).
- Cards / tonal cards (cyan-tinted shadow) → Task 1 (`Card`/`TonalCard`).
- Icons (Material Symbols + `icon-filled`) → Task 1 (`Icon`).
- Processing overlay (concentric spinner + pulse-ring + check_circle/sync checklist, success → secondary + Done) → Task 5.
- Scan-line animation → Task 4 (`ScanFrame`, `animate-scan`).
- Footer (lock eyebrow + configurable regulatory line) → Task 8.

**Placeholder scan:** every component shows COMPLETE TSX (no `// ...` in shipped code, no TODO bodies). The only TODO is the explicit `proxy.ts` `Permissions-Policy: camera` dependency check in Task 4 (a Phase 2 coordination point), not a code placeholder.

**API field-name check vs Phase 5 contracts:** `GET /api/wallet` → `publicKey/balanceXlm/reservedXlm/availableXlm/approxPhp` (Tasks 3, 5); `GET /api/wallet/deposit-address` → `publicKey/qrSvg/network/memoRequired` (Tasks 3, 6); `POST /api/wallet/sync` → `balanceXlm` (Task 6); `GET /api/wallet/transactions` → `items/nextCursor` (available, though Task 7 lists _payments_, not wallet ledger); `POST /api/qrph/decode` → `decoded/merchant?` (Task 4); `POST /api/payments/quote` → `paymentId/amountPhp/rate/amountXlm/networkFeeXlm/quoteExpiresAt` (Tasks 4, 5); `POST /api/payments/[id]/confirm` → `paymentId/status` + `Idempotency-Key` header (Task 5); `GET /api/payments/[id]` → `payment/events` (Tasks 5, 7); `POST /api/payments/[id]/cancel` → `status` (Task 5); `POST /api/auth/password` → `204` (Task 8). **Open item to confirm against Phase 5:** the payer-scoped _payments_ list path used in Task 7 (`GET /api/payments?cursor=&limit=`) and each list item's field shape — Phase 5 must expose this (or Task 7 must read via a `server/payer/data.ts` Prisma helper). Resolve before implementing Task 7; do not invent a new contract.

**Accessibility/perf/responsive (AGENT §4, BRAND §8) honored across all tasks:** WCAG AA token usage, no orange small body text, status by text+badge, real labels, focus rings, ≥44px targets, `prefers-reduced-motion` via the global CSS rule (animations are decorative-only; data updates never depend on motion), RSC-first with small client leaves, server-only data helpers, cursor pagination.
