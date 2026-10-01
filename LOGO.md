# LOGO.md — HeyPay Logo Generation Prompts

Image-generation prompts for the HeyPay brand mark, derived from `SPEC.md`
(product: bridging a Stellar/XLM custodial wallet to QRPH merchant payments in
the Philippines) and `BRAND.md` (visual identity: Material 3 tonal fintech,
cyan `#00bcd4` primary / orange `#ff9800` accent, confident-precise-friendly-
secure personality, rounded/pill geometry, `star` + `account_balance_wallet`
as the recurring brand glyphs).

**Concept:** a single abstract glyph that fuses a **four-pointed Stellar
star** with a **QR scan-corner bracket**, reading simultaneously as "star"
(Stellar/XLM) and "scan to pay" (QRPH). This ties the mark directly to
HeyPay's core mechanic — pay any QRPH code with your XLM balance — without
relying on a wallet or coin cliché.

**General style (applies to all three variants):**

- Symbol only — **no text, no wordmark, no letterforms**.
- Single, self-contained glyph that reads clearly at 24px (favicon/app-icon
  scale) and at billboard scale alike.
- Geometric, precise construction (Material 3 sensibility): a four-pointed
  Stellar-style star (concave diamond points, not a 5-point star) with one
  corner subtly opened into an **L-shaped scan bracket**, echoing a QR
  finder-pattern corner.
- Contained in a **rounded-square badge** (matches `BRAND.md`'s `radius-xl`
  16px rounding), not a hard square or a full circle.
- Generous internal padding, optically balanced, perfectly symmetric except
  for the single scan-bracket notch that signals "scan."
- Flat vector illustration, no gradients, no drop shadows, no bevels, no
  photorealism, no mascots, no 3D rendering, no textures.
- Clean outer silhouette with no fine internal hairlines that would break up
  at small sizes.
- Output as a crisp vector-style graphic on a plain, uncluttered background
  (transparent or solid, per variant below), centered, with margin around
  the glyph equal to roughly 15% of the canvas on each side.

---

## 1. Colored version (primary logo)

```
Flat vector app icon / logo mark for a fintech brand called HeyPay.
Symbol only, no text, no letters, no wordmark.

Subject: a single abstract glyph that merges a four-pointed Stellar-style
star (concave diamond points, like a compass/sparkle) with a QR-code
finder-pattern corner bracket — one of the star's four points opens into a
simple L-shaped bracket, so the mark reads as both "star" and "scan
target." Perfectly centered, optically balanced, minimal, geometric,
Material Design 3 precision.

Container: rounded-square badge (soft ~20% corner radius), not a circle,
not a hard-edged square.

Color: the glyph rendered in a cyan-to-deep-cyan tone (#00bcd4 primary,
#0097a7 as a subtle deeper accent on the bracket notch only) on a solid
rounded-square badge background of soft near-white (#fcf9f8) OR the glyph
in solid white on a solid cyan (#00bcd4) rounded-square badge — pick
whichever reads cleaner as one cohesive lockup. Optionally use a single
small orange (#ff9800) accent dot or fill only inside the scan-bracket
notch to signal "live/active," used sparingly, never covering more than
10% of the glyph.

Style: flat vector, no gradients, no drop shadows, no bevels, no
photorealism, no mascots, no 3D. Clean, confident, trustworthy fintech
feel — calm and modern, not playful or cartoonish. Crisp edges, consistent
stroke/fill weight, legible at both 24px favicon scale and large app-icon
scale.

Background: plain transparent or solid off-white background outside the
badge, centered composition, square 1:1 canvas.
```

---

## 2. White-only silhouette (for dark backgrounds)

```
Flat vector logo mark, single-color silhouette version.
Symbol only, no text, no letters, no wordmark.

Subject: identical glyph to the primary HeyPay mark — a single abstract
four-pointed Stellar-style star (concave diamond points) with one point
opened into a simple L-shaped QR finder-pattern scan bracket. Perfectly
centered, geometric, Material Design 3 precision, same proportions and
silhouette as the colored version, contained within the same rounded-
square badge outline (soft ~20% corner radius) rendered as a thin outline
or omitted — glyph is the hero.

Color: pure solid white (#FFFFFF) glyph only — completely flat, no
gradients, no shading, no outlines of any other color, no transparency
gradients. One flat white shape.

Background: solid dark background (near-black, e.g. #1d1b1a) to preview
the mark as it will sit on dark UI surfaces, dark app icons, or dark
merch. High contrast, crisp clean edges, no anti-aliasing artifacts, no
soft glow.

Style: flat vector silhouette, no gradients, no drop shadows, no bevels,
no photorealism, no 3D. Must remain legible and recognizable purely from
its outline/negative-space shape at small sizes (24px favicon scale).

Composition: centered, square 1:1 canvas, generous margin around the
glyph.
```

---

## 3. Dark-only silhouette (for light backgrounds)

```
Flat vector logo mark, single-color silhouette version.
Symbol only, no text, no letters, no wordmark.

Subject: identical glyph to the primary HeyPay mark — a single abstract
four-pointed Stellar-style star (concave diamond points) with one point
opened into a simple L-shaped QR finder-pattern scan bracket. Perfectly
centered, geometric, Material Design 3 precision, same proportions and
silhouette as the colored version, contained within the same rounded-
square badge outline (soft ~20% corner radius) rendered as a thin outline
or omitted — glyph is the hero.

Color: pure solid dark charcoal (#1d1b1a, HeyPay's on-surface ink color)
glyph only — completely flat, no gradients, no shading, no outlines of any
other color, no transparency gradients. One flat dark shape.

Background: solid light/white background (near-white, e.g. #fcf9f8) to
preview the mark as it will sit on light UI surfaces, light app icons, or
printed materials. High contrast, crisp clean edges, no anti-aliasing
artifacts, no soft shadow.

Style: flat vector silhouette, no gradients, no drop shadows, no bevels,
no photorealism, no 3D. Must remain legible and recognizable purely from
its outline/negative-space shape at small sizes (24px favicon scale).

Composition: centered, square 1:1 canvas, generous margin around the
glyph.
```

---

## Usage notes

- The three variants must share **one identical glyph silhouette** — only
  fill color and background change between them. Do not let the shape
  drift between prompts/generations; use the colored version's output as a
  shape reference when generating the two silhouette variants.
- Reserve orange (`#ff9800`) as a _minor_ accent only in the colored
  variant — the silhouette variants are strictly single-color per
  `BRAND.md` §8 (status must never rely on color alone, and monochrome
  marks must remain legible without it).
- Do not use a five-pointed star, a generic wallet icon, a peso/dollar
  sign, or a literal QR code pattern — the goal is one original abstract
  mark, not a literal icon combination.
