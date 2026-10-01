# BRAND.md — HeyPay Design System

> Design and theming guidance for HeyPay, derived from the approved mock HTML.
> This file is the single source of truth for visual identity. The coding agent
> must encode every token below into the Tailwind v4 `@theme` block and reuse
> the named tokens rather than hard-coding hex values or pixel sizes.

---

## 1. Brand essence

HeyPay lets Filipinos pay any QRPH merchant using their Stellar (XLM) balance.
The brand should feel like **trustworthy fintech infrastructure**: clean, calm,
and modern, with a "behind the scenes the blockchain is doing the work" feeling.

- **Personality:** confident, precise, friendly, regulated/secure.
- **Voice:** plain and reassuring. Short labels, no jargon in primary UI
  ("Confirm Payment", "Pay From", "Scan QRPH"). Technical detail (XLM amounts,
  rates, network fees) is shown in a monospaced data style, visually secondary.
- **Feel:** Material 3 tonal surfaces, soft cyan-tinted shadows, generous
  rounding, subtle motion (pulse, scan, spin) reserved for _processing_ states.

---

## 2. Color tokens

The palette is a Material-3-style tonal system built around **Cyan #00bcd4**
(primary) and **Orange #ff9800** (accent / live / pending). Background is a warm
near-white `#fcf9f8`. Encode all of these as CSS variables.

### Core brand

| Token                                  | Hex       | Usage                                                                   |
| -------------------------------------- | --------- | ----------------------------------------------------------------------- |
| `primary`                              | `#00bcd4` | Primary actions, brand text, active nav, links, balance figures         |
| `on-primary`                           | `#ffffff` | Text/icons on primary fills                                             |
| `primary-container`                    | `#b2ebf2` | Tonal chips, active nav background, info cards                          |
| `on-primary-container`                 | `#002024` | Text on primary-container                                               |
| `secondary` _(a.k.a. accent / orange)_ | `#ff9800` | "LIVE"/"PENDING" status, success-paid state, secondary CTAs, highlights |
| `on-secondary`                         | `#ffffff` | Text/icons on orange fills                                              |
| `secondary-container`                  | `#ffe0b2` | Soft orange backgrounds                                                 |
| `on-secondary-container`               | `#e65100` | Text on secondary-container                                             |
| `tertiary`                             | `#0097a7` | Deep cyan support accent (sparingly)                                    |
| `on-tertiary`                          | `#ffffff` | Text on tertiary                                                        |

> **Naming note:** the mocks are inconsistent — orange appears as `secondary` in
> the payer-confirm screen and as `tertiary` in the dashboards. **Standardize on
> `secondary = #ff9800` (orange)** across the whole app. Provide an alias utility
> `accent` mapped to the same value to ease migration of any copied markup.

### Surfaces & neutrals

| Token                       | Hex       | Usage                                      |
| --------------------------- | --------- | ------------------------------------------ |
| `background`                | `#fcf9f8` | App background                             |
| `on-background`             | `#1d1b1a` | Body text on background                    |
| `surface`                   | `#fcf9f8` | Default surface                            |
| `on-surface`                | `#1d1b1a` | Text on surface                            |
| `surface-variant`           | `#eee8e5` | Subtle filled areas                        |
| `on-surface-variant`        | `#4e4643` | Secondary/muted text, captions             |
| `surface-container-lowest`  | `#ffffff` | Cards (white)                              |
| `surface-container-low`     | `#f6f3f2` | Inset panels, table header rows            |
| `surface-container`         | `#f0edea` | Logo tiles, neutral fills                  |
| `surface-container-high`    | `#ebe7e4` | Hover fills, avatars                       |
| `surface-container-highest` | `#e5e1de` | Strongest neutral fill (wallet source row) |
| `outline`                   | `#807673` | Icon strokes, muted labels                 |
| `outline-variant`           | `#d2c5c1` | Borders, dividers                          |

### Status

| Token                  | Hex                       | Usage                             |
| ---------------------- | ------------------------- | --------------------------------- |
| `error`                | `#ba1a1a`                 | Errors, destructive (logout text) |
| `on-error`             | `#ffffff`                 | Text on error                     |
| `success`              | use `primary` `#00bcd4`   | "Settled" badge                   |
| `warning`/`processing` | use `secondary` `#ff9800` | "Pending Trade", "LIVE", spinners |

### Semantic mapping (state → token)

- **Settled / confirmed / verified** → `primary` (cyan dot + `primary/10` chip).
- **Pending / live / processing** → `secondary` (orange dot, `pulse`/`status-pulse`).
- **Success terminal screen** → headline flips from `primary` to `secondary`.

---

## 3. Typography

Two families. **Lexend** for display/headlines/labels, **Inter** for body and
monospaced data. (One mock used Lexend everywhere; standardize on the two-family
system below — it matches both dashboards.)

- **Headlines / display / labels:** `Lexend` (400, 500, 600, 700)
- **Body / mono-data:** `Inter` (400, 500, 600, 700)
- Load via Google Fonts (or self-host with `next/font` for performance/privacy).

### Type scale (encode as fontSize tokens)

| Token                | Size / line-height | Tracking | Weight | Family | Usage                                     |
| -------------------- | ------------------ | -------- | ------ | ------ | ----------------------------------------- |
| `display-lg`         | 48px / 56px        | -0.02em  | 700    | Lexend | Total balance, big amounts                |
| `headline-lg`        | 32px / 40px        | —        | 600    | Lexend | Page titles (desktop)                     |
| `headline-lg-mobile` | 24px / 32px        | —        | 600    | Lexend | Page titles (mobile)                      |
| `headline-md`        | 24px / 32px        | —        | 500    | Lexend | Section / card titles, merchant name      |
| `body-lg`            | 18px / 28px        | —        | 400    | Inter  | Emphasis body, secondary buttons          |
| `body-md`            | 16px / 24px        | —        | 400    | Inter  | Default body                              |
| `body-sm`            | 14px / 20px        | —        | 400    | Inter  | Captions, helper text                     |
| `label-md`           | 12px / 16px        | +0.05em  | 600    | Lexend | UPPERCASE labels, badges, eyebrows        |
| `mono-data`          | 14px / 20px        | -0.01em  | 500    | Inter  | XLM/PHP amounts, rates, addresses, tx IDs |

**Rules**

- All on-chain/financial numerics (XLM, PHP, rates, fees, wallet addresses, tx
  IDs) use `mono-data`. Truncate long Stellar addresses/tx hashes with ellipsis.
- `label-md` is always UPPERCASE with wide tracking for eyebrows and badges.
- Display figures (balances) use `display-lg` in `primary`.

---

## 4. Spacing & layout

Encode this spacing scale (named, not raw px):

| Token                 | Value |
| --------------------- | ----- |
| `unit`                | 4px   |
| `stack-sm`            | 8px   |
| `gutter` / `stack-md` | 16px  |
| `stack-lg`            | 24px  |
| `margin-mobile`       | 20px  |
| `margin-desktop`      | 40px  |

**Layout**

- App max width for centered content: `max-w-7xl` (1280px) with horizontal
  padding `margin-mobile` (mobile) / `margin-desktop` (desktop).
- Payer single-column flows (confirm/pay) center in `max-w-lg`.
- Merchant/Payer dashboards use a fixed **left SideNav `w-64` (256px)** on `lg+`,
  content offset by `lg:ml-64`. Below `lg`, SideNav is hidden and a **bottom
  mobile nav bar (`h-16`)** appears.
- Dashboard content uses a **bento grid** (`grid-cols-1 md:grid-cols-12` or
  `lg:grid-cols-3`) with `gap-stack-lg`.

---

## 5. Radius, elevation & effects

### Border radius

| Token     | Value  | Usage                                     |
| --------- | ------ | ----------------------------------------- |
| `DEFAULT` | 8px    | Inputs, small chips                       |
| `lg`      | 8px    | Cards, buttons, panels                    |
| `xl`      | 16px   | Hero cards, tonal cards, QR frames        |
| `full`    | 9999px | Pills, primary CTAs, avatars, status dots |

> Note: primary action buttons in the payer flow are **fully rounded pills**
> (`rounded-full`), while dashboard cards/buttons use `rounded-lg`. Keep this
> distinction: consumer payment actions = pill; data/admin surfaces = `lg`.

### Elevation (cyan-tinted shadows)

- **Tonal/bento card:** `background:#fff; box-shadow: 0 8px 24px rgba(0,188,212,0.08)`.
  Hover (dashboard cards): lift `translateY(-2px)` + `0 8px 24px rgba(0,188,212,0.12)`.
- **Primary CTA:** `shadow-lg shadow-primary/20`.
- **Glass header / nav:** `background: rgba(252,249,248,0.7); backdrop-filter: blur(20px)`.

### Motion (reserved for live/processing states only)

| Name                          | Spec                                                      | Where                        |
| ----------------------------- | --------------------------------------------------------- | ---------------------------- |
| `pulse-ring`                  | scale 0.95↔1.05, opacity 0.5↔0.3, 2s ease-in-out infinite | Processing overlay ring      |
| `status-pulse` / `pulse-slow` | opacity 1↔0.5, 2s cubic-bezier(.4,0,.6,1) infinite        | "Pending Trade", "LIVE" dots |
| `pulse-pending`               | same family                                               | Payer "PENDING" badge        |
| spinner                       | `animate-spin` on a `border-t-4 border-primary` ring      | Trade processing             |
| `scan`                        | top 0%↔100%, 2s linear infinite                           | QR upload scanner line       |

Respect `prefers-reduced-motion`: disable the above animations when set.

---

## 6. Iconography

- **Material Symbols Outlined**, default `font-variation-settings: 'FILL' 0,
'wght' 400, 'GRAD' 0, 'opsz' 24`.
- Use `FILL 1` for active/selected nav items and brand glyphs
  (`account_balance_wallet`, `star`, `verified`, `payments`).
- Recurring glyphs: `qr_code_scanner`, `qr_code_2`, `account_balance_wallet`,
  `star` (Stellar wallet), `trending_up`, `sync` (processing), `check_circle`,
  `lock`, `verified`, `history`, `dashboard`, `settings`, `content_copy`,
  `chevron_right`, `arrow_forward`, `support_agent`, `hub`, `send`, `add_circle`.

---

## 7. Component patterns (from the mocks)

**Top nav (consumer):** glass header, brand lockup = filled
`account_balance_wallet` in `primary` + "HeyPay" wordmark (`headline-md`, bold,
`primary`). Right side: Payer/Merchant text tabs (active = `primary` with
`border-b-2`), `notifications`, `settings`, avatar.

**Side nav (dashboards):** `surface-container-low`, `w-64`, brand title in
`primary`, profile block, nav items (active = `primary-container` /
`on-primary-container`, bold; inactive = `on-surface-variant` with
`hover:bg-surface-container-high`). Primary "Scan to Pay" button + Support/Logout
footer (logout text in `error`).

**Cards:**

- _Tonal/bento card_: white, `rounded-xl`/`rounded-lg`, cyan-tinted shadow.
- _Hero balance card_: white card with blurred `primary/5` decorative blob,
  `display-lg` figure in `primary`, PHP equivalent in `headline-md`
  `on-surface-variant`, paired pill CTAs (filled "Prefund", outlined "Send").
- _Scan QRPH CTA_: solid `primary` card, white text, inner orange (`secondary`)
  "Start Payment" button.

**Buttons:**

- _Primary pill_ (payer): `bg-primary text-on-primary rounded-full py-4`,
  `headline-md` bold, `shadow-lg shadow-primary/20`, hover `brightness-110`,
  active `scale-95`, often with trailing `arrow_forward`.
- _Secondary/outline pill_: `border-2 border-primary text-primary rounded-full`.
- _Onboarding "Continue/Next"_: `bg-secondary text-on-secondary rounded-full`,
  hover lift `-translate-y-[2px]`.

**Status badges:** pill chips `px-3 py-1 rounded-full` with a leading
`w-1.5 h-1.5 rounded-full` dot. Settled = `bg-primary/10 text-primary`; Pending =
`bg-secondary/10 text-secondary` + `status-pulse`.

**Tables (merchant):** header row `bg-surface-container-low` with `label-md`
`outline` headers; rows divided by `outline-variant`; amounts in `mono-data`;
status as badge. Show paired values: XLM (bold mono) with PHP approximation in
small `outline` text beneath.

**Forms (onboarding):** floating-label inputs (`peer` + label transform on
focus/filled), 4-segment progress bar (filled segments = `primary`), radio-card
bank selector using `has-[:checked]:border-primary`, live phone-mockup preview
on the right that updates as the merchant types.

**Processing overlay:** full-screen `surface/95` + `backdrop-blur-md`, concentric
spinner (`primary` arc) + `pulse-ring`, step checklist with `check_circle` (done)
and `sync` + `pulse` (in-progress). On success, headline switches to `secondary`
and a "Done" button appears.

**Footer:** muted, centered, `lock` + "END-TO-END ENCRYPTED" eyebrow, and a
version/regulatory line ("HeyPay v2.4.0 • Licensed by BSP"). Keep the regulatory
note configurable, not hard-coded.

---

## 8. Accessibility

- Maintain WCAG AA contrast. `on-surface-variant #4e4643` on `background` passes
  for body; do **not** use `outline #807673` for long-form body text (labels only).
- Orange `#ff9800` text on white is below AA for small text — only use orange for
  ≥`label-md` bold badges, icons, and large numerics, never for small body copy.
  For orange CTAs use `on-secondary #ffffff` text.
- All status must be conveyed by **text/badge**, not color alone (dot + label).
- Inputs need real `<label>`s (floating labels must keep an accessible name).
- Provide visible focus rings (`focus:ring-4 focus:ring-primary/10`).
- Honor `prefers-reduced-motion` (disable pulse/scan/spin).
- Target sizes ≥ 44×44px for tap targets (mobile nav, FAB).

---

## 9. Tailwind v4 `@theme` starter

Tailwind v4 is CSS-first (no `tailwind.config.js` required). Put this in
`app/globals.css`. Use the `--color-*`, `--font-*`, `--text-*`, `--radius-*`,
`--spacing-*` token namespaces so utilities like `bg-primary`, `text-display-lg`,
`rounded-xl`, `p-stack-lg` are generated.

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

> Material Symbols: load the font and set the default variation settings globally;
> use a `.icon-filled` helper that sets `'FILL' 1` for active states.

---

## 10. Do / Don't

**Do**

- Reference tokens (`bg-primary`, `text-mono-data`, `p-stack-lg`).
- Keep cyan for trust/confirmed, orange for live/pending/processing.
- Use pills for consumer payment CTAs, `lg` radius for data surfaces.
- Show XLM and PHP together; XLM primary, PHP as the human reference.

**Don't**

- Hard-code hex/px values or invent new greens/reds outside the tokens.
- Use orange for small body text (fails contrast).
- Animate anything that isn't a live/processing indicator.
- Mix the two orange aliases inconsistently — `secondary` is canonical.
