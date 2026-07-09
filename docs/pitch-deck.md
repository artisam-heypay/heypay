# HeyPay — Pitch Deck Guide

> One file, one slide per section. Speak to the speaker notes; the slide bodies
> stay minimal. This guide mirrors **`docs/pitch-deck-v3.pptx`** (12 slides,
> branded, with full speaker notes). A read-aloud recording script and an
> investor/judge **Q&A guide** are at the bottom.
>
> **What's new in v3** (vs. the original 8-slide draft): a product-status slide,
> and three strategy slides — **Impact on the Stellar Ecosystem**, a **Stellar
> integration roadmap** (SEPs / anchors / USDC / DEX / Soroban), and a tiered
> **Philippines → APAC → Global go-to-market** plan. The ecosystem content is
> sourced from the research report in **GitHub issue #160**.

---

## Slide 1: Title

- **HeyPay**
- Pay any QRPH merchant with your Stellar balance.
- Built for the Philippines, designed to plug into Stellar's global rails.
- Project Lead: **[NAME]** · Team: **[PLACEHOLDER: team name]**

![Real brand hero: phone scanning QRPH → cyan payment streams → Manila skyline at golden hour, with the HeyPay logo + wordmark lockup over a bottom scrim.](../homepage/hero.jpg)

**Speaker notes:**
Hi everyone, we're [team name], and this is HeyPay. Our one-liner: let anyone holding Stellar-network crypto pay at any QRPH merchant in the Philippines, with the merchant receiving pesos and zero new integration on their side. QRPH is already everywhere in the country; we connect it to a balance people already hold on Stellar. Today I'll cover the problem, a live demo, how it works, our impact on the Stellar ecosystem, how we plan to plug into Stellar's native rails (anchors, SEPs, the DEX), and our go-to-market plan from the Philippines outward to APAC and global.

---

## Slide 2: Problem — Two Worlds That Don't Talk

- Two payment worlds that don't talk to each other:
  - **Merchants** — millions of Philippine businesses accept **QRPH** (the national QR standard), settled to their PHP bank account.
  - **Crypto holders** — people holding XLM have **no way to spend it** at those merchants.
- To pay today, a holder must: off-ramp to PHP on an exchange → withdraw to a bank → then pay via QRPH. Slow, manual, multiple apps, multiple fees.
- Merchants won't integrate anything new — they already have a working QR.

**Speaker notes:**
The core problem is a disconnected pair of worlds. Philippine merchants have widely adopted QRPH, the BSP national QR standard, which lands pesos straight in their bank account. Meanwhile people holding Stellar-network crypto like XLM can't spend it at those merchants directly. Today the only path is manual: sell crypto on an exchange, withdraw pesos to a bank, then go pay. That's several apps, several fees, several minutes — and it defeats the point of holding crypto for everyday spend. Merchants, for their part, won't adopt a new system; they already have a working QR. HeyPay exists to bridge exactly this gap.

---

## Slide 3: The Solution

**HeyPay: pay any QRPH merchant straight from your XLM balance — the merchant gets PHP in their bank, with no new integration on their side.**

- **Pay QRPH straight from your XLM balance** — no manual off-ramp step.
- **One scan** of the merchant's existing QRPH code — camera or photo.
- **Live, locked XLM→PHP rate** shown before the payer confirms.
- **Merchant gets PHP** in their existing bank account — zero new integration.

**Speaker notes:**
HeyPay is a custodial bridge. A payer prefunds their HeyPay wallet with XLM, scans any QRPH code, sees a live conversion rate, and confirms. Behind the scenes we sell that XLM for pesos via our exchange partner and pay the pesos straight into the merchant's registered bank account. The merchant doesn't install anything, change their QR, or learn a new tool — they just register the QR they already display and the bank account they already use once, during onboarding. From the payer's side it feels like one-tap payment; from the merchant's side it's just another QRPH payment landing as PHP.

---

## Slide 4: Live Demo — Payer to Merchant

The hero flow — payer pays a merchant end-to-end:

1. **Prefund** — wallet with XLM; balance updates as the deposit lands.
2. **Scan** — the merchant's QRPH code (camera or photo).
3. **Confirm** — amount and live rate, then tap to pay.
4. **Watch it settle** — live status overlay → merchant paid in PHP.

[PLACEHOLDER: Demo video — a 60–90 second screen recording of the full payer happy path (prefund → scan → confirm → live processing overlay → settled), then a 15 second cut to the merchant dashboard showing the received PHP. No audio needed; overlay text narrates each step.]

**Speaker notes:**
Here's the whole flow in one go. The payer starts on their dashboard, prefunds with XLM — the balance updates as the deposit clears. They hit Scan, point the camera at a merchant's QRPH code, and HeyPay recognizes it as a registered merchant. They enter the amount, see the live rate and exactly how much XLM leaves their wallet, and confirm. The processing overlay then shows every step happening in real time — rate locked, selling the XLM, paying out to the bank — until it confirms pesos were sent to the merchant. Cut to the merchant side: their dashboard shows the settled PHP and the transaction in their history.

---

## Slide 5: How It Works

A web app plus a background worker — the payer never waits on the slow parts.

- **Scan & decode** to the national EMVCo standard (CRC-checked), matched to a registered merchant.
- **Quote & lock** a live XLM→PHP rate; the exact XLM (plus a network fee) is reserved.
- **Settle in the background** — a worker moves the XLM, sells for PHP, pays out. Idempotent, resumable.
- **Live status** — the payer's screen tracks real progress; auto-refund on failure.

**Speaker notes:**
Under the hood it's a web app the payer talks to, plus a separate background worker doing the slow money movement. When you scan, we decode the QR to the national standard and match it to a registered merchant. When you confirm, we fetch a live conversion rate, lock it for a short window, and reserve the exact XLM from your wallet so it can't be spent twice. A job worker then moves the XLM, sells it for pesos through our exchange partner, and pays the pesos to the merchant's bank. Every step is saved and resumable — if the server restarts mid-payment it picks up where it left off — and if something fails after funds moved, the payer is refunded automatically.

---

## Slide 6: Where We Are Today _(new in v3)_

- **Feature-complete** against our full spec: payer, merchant, and admin surfaces all shipped.
- **Admin console live** — user/merchant management, payment retry & refund, system health.
- **Tested** — 56 unit/integration tests plus a 4-scenario end-to-end suite, wired into CI.
- **Deployable today** — containerized, with a one-command Railway deployment config.

> This isn't a mockup — it's a working app we can demo end to end, right now.

**Speaker notes:**
Before we talk about impact and growth, a quick credibility check: this is not slideware. Every flow we just walked through — payer prefund/scan/pay/history, merchant onboarding/dashboard/transactions, and a full admin console with user, merchant, and payment oversight including manual retry and refund — is implemented and tested today. We have 56 automated unit and integration tests plus a 4-scenario end-to-end suite running in CI, and a containerized deployment config ready for Railway. What follows is a real roadmap on top of a real, running product — not a wishlist for something that doesn't exist yet.

---

## Slide 7: Impact & Market — Philippines

- **Payers** spend crypto without manually off-ramping first.
- **Merchants** get crypto-funded payments while still receiving plain PHP.
- **QRPH is the national rail** — already displayed by merchants everywhere.
- **A bridge, not yet-another-app** — we plug into the rail merchants already use.

> $38B+ in annual PH remittances and a fast-growing crypto-holding population make the Philippines the ideal proving ground.

**Speaker notes:**
Who actually needs this? Two groups: crypto holders who want to spend their balance on real things without the manual off-ramp dance, and merchants who'd love crypto-backed payments but won't integrate anything new or touch crypto themselves. The Philippines is the ideal proving ground — QRPH is already the national standard, on shop windows everywhere, settling straight to bank accounts. Pair that with one of the world's largest remittance corridors, driven by millions of overseas Filipino workers, and a fast-growing crypto-holding population, and the bridge we've built is the missing piece. We're not asking merchants to adopt a new app — we plug into the rail they already use.

---

## Slide 8: Our Impact on the Stellar Ecosystem _(new in v3)_

- **Everyday-spend utility for XLM** — the missing last mile that turns a held Stellar balance into a real-world payment, not just a speculative asset.
- **Compounds an active corridor** — the Philippines is already a proven Stellar remittance corridor (Coins.ph since 2016, Cebuana Lhuillier, MoneyGram, Tempo × Arf); HeyPay extends that rail from inbound remittance to everyday outbound spend.
- **A template, not a one-off** — "custodial wallet + local QR rail + local off-ramp" is a pattern any Stellar team can replicate for any country with a national QR standard.
- **Real transaction volume for Stellar** — every HeyPay payment is a genuine Horizon-settled transaction, adding to Stellar's real-world _payment_ volume (not trading/speculative volume).

**Speaker notes:**
Beyond HeyPay as a single app, here's why this matters for Stellar. XLM's biggest real-world traction today is inbound remittance — Coins.ph has run a live Stellar integration since 2016, and partners like Cebuana Lhuillier, MoneyGram, and the Tempo/Arf corridor all use Stellar to move money INTO the Philippines. HeyPay closes the other half of that loop: once money has landed on Stellar, we let people actually SPEND it locally, at merchants who've changed nothing about how they operate. That's the "everyday spend utility" Stellar has been missing — turning a held balance into a real transaction, not just a remittance waypoint. And because our architecture — custodial wallet, local QR standard, local off-ramp partner — isn't Philippines-specific in concept, it's a pattern any team could replicate wherever a national QR standard exists. Every payment we settle is also a genuine, real-economy Horizon transaction, which is exactly the kind of volume that strengthens Stellar's case as payments infrastructure rather than a trading venue.

---

## Slide 9: Plugging Into Stellar's Native Rails _(new in v3)_

**Ecosystem integration roadmap** — from a single-rail MVP to real Stellar infrastructure.

- **Today:** one custodial asset (XLM), one off-chain partner (PDAX via plain REST API) — a working but single-rail MVP.
- **SEP-1 / SEP-10 / SEP-12** — publish our `stellar.toml`, add Stellar web-auth, and model KYC to the standard schema so it's portable to any future anchor.
- **SEP-6 / SEP-24 / SEP-38 / SEP-31** — treat licensed Philippine anchors as interchangeable on/off-ramp and quote providers, and use SEP-31 for the merchant bank-payout leg, reducing single-exchange dependence on PDAX.
- **USDC on Stellar** — a second custodial asset to remove XLM price-volatility risk between prefund and spend.
- **Stellar DEX / path payments** — explore on-chain conversion (e.g. XLM→USDC) as a lower-cost, less centralized complement to our exchange partner.
- **Soroban escrow contract** — hold funds on-chain until merchant payout confirms, cutting reliance on off-chain refund logic.

**Speaker notes:**
We know exactly how we get from a single-rail MVP to real Stellar infrastructure, and we already have a detailed research report to back it. Right now, our entire settlement path runs through one exchange partner over a plain REST API — that's a real business risk and it's not how Stellar was designed to be used. Our roadmap: first, the cheap wins — publish a stellar.toml under SEP-1, add SEP-10 web authentication, and model our KYC data to the SEP-12 standard from day one. Next, the real unlock — SEP-6 and SEP-24 let us treat multiple licensed Philippine anchors as interchangeable liquidity providers instead of being locked to one exchange; SEP-38 gives us a standard quote interface to rate-shop across them; and SEP-31 is a natural fit for our merchant payout leg. In parallel, we'll add USDC as a second custodial asset to remove crypto-price volatility between prefund and spend, explore Stellar's built-in DEX and path payments as a lower-cost complement to our exchange partner, and prototype a Soroban escrow contract so funds are provably held on-chain until a merchant payout is confirmed. Notably, our current exchange partner has already run its own Stellar remittance partnership and hosted a Stellar hackathon at its Manila office — so this isn't cold outreach, it's a natural next conversation.

---

## Slide 10: Go-To-Market — Philippines → APAC → Global _(new in v3)_

**Philippines (now):**

- Launch on QRPH, HeyPay's proven home rail.
- Grow via the existing OFW remittance corridor — let overseas senders fund a payer's HeyPay wallet directly, not just people who already hold XLM.
- Engage BSP-aligned compliance (VASP/KYC) early.
- Partner-led growth via our exchange partner's own Stellar ecosystem activity (hackathons, prior remittance partnerships).

**APAC (next 12–18 months):**

- Replicate the model wherever a national QR standard + a licensed local anchor both exist (e.g. PromptPay/Thailand, VietQR/Vietnam, DuitNow/Malaysia).
- Same architecture — swap the QR standard and the local off-ramp partner.
- Pursue SDF's APAC-focused grant and hackathon programs for co-marketing and funding.

**Global (18 months+):**

- Once the SEP-6/24/31 anchor abstraction is proven in 2+ markets, HeyPay becomes a reusable "Stellar-to-local-QR" bridge pattern rather than a single app.
- License or white-label the pattern, or plug into any market with EMVCo-style merchant-presented QR and a Stellar anchor.

**Speaker notes:**
Our go-to-market is deliberately staged. In the Philippines, right now, we launch on QRPH because it's the rail we've already built and proven, and we grow through the country's enormous OFW remittance corridor — the biggest unlock here isn't converting existing XLM holders, it's letting an overseas relative fund a payer's HeyPay wallet directly, so the addressable market is remittance senders and receivers, not just existing crypto holders. We engage BSP-style compliance early rather than late, and we lean on our exchange partner's own visible Stellar ecosystem activity for warm introductions rather than cold outreach. Over the next twelve to eighteen months, we take the same architecture to other APAC markets that share the two ingredients we need — a national merchant-presented QR standard and a licensed local off-ramp partner — think Thailand's PromptPay, Vietnam's VietQR, Malaysia's DuitNow. We'd pursue SDF's APAC-focused grant and hackathon programs along the way, both for funding and credibility. Beyond eighteen months, once we've proven the SEP-6/24/31 anchor abstraction across at least two markets, HeyPay stops being one app and becomes a reusable pattern — a Stellar-to-local-QR bridge that can plug into any market with an EMVCo-style QR standard and a Stellar anchor, globally.

---

## Slide 11: What's Next

- **Real KYC / AML, 2FA & fraud scoring** — required before any real money movement at scale.
- **Explicit fee model** — a transparent markup / merchant discount rate; today's margin is implicit.
- **Merchant discovery & recurring payments** — beyond point-of-sale into a bigger PH payments TAM.
- **Native mobile apps** — today it's responsive web.
- **Alerting on top of our health dashboard** — proactive ops, not just an admin checking a screen.

**Speaker notes:**
What's built today is a real, working, feature-complete MVP across payer, merchant, and admin. What's left is what turns it into a licensed, scalable business: real KYC, AML, two-factor auth and fraud scoring, which are required before we move real money at scale; an explicit, transparent fee model, since today our margin is implicitly whatever spread our exchange partner allows; merchant discovery and recurring payments to grow beyond point-of-sale into a much larger slice of Philippine payments; native mobile apps on top of the responsive web app we already have; and proactive alerting on top of the health dashboard we've already built, so issues surface to an operator automatically instead of requiring someone to check a screen.

---

## Slide 12: Team & Thanks

- **[PLACEHOLDER: name]** — role
- **[PLACEHOLDER: name]** — role
- **[PLACEHOLDER: name]** — role
- Contact: **[PLACEHOLDER: email / handle / project URL]**

Thanks to the hackathon organizers, the Stellar developer documentation, and our exchange partner's public API documentation that informed the integration design.

**Speaker notes:**
We're [team name] — [brief intro per member]. Thanks to the organizers for the event, to the open Stellar developer documentation that made prototyping the payment-rail integration realistic, and to our exchange partner's public API docs. We'd love to talk to anyone interested in payments, Stellar ecosystem growth, or the Philippine market. You can reach us at [contact], and the project is at [URL]. Happy to take questions.

---

# Recording script

_Read this straight through for a ~4–5 minute recording. Pauses are marked with `[pause]`._

**[Slide 1 — Title]**
Hey, everyone. We're [team name], and this is HeyPay. Our pitch in one line: let anyone holding Stellar-network crypto pay at any QRPH merchant in the Philippines — and let those merchants receive pesos with zero new integration. QRPH is already everywhere in the country. We just connect it to a balance people already hold on Stellar. I'll walk you through the problem, a live demo, how it works, our impact on the Stellar ecosystem, our integration roadmap, and our go-to-market. [pause]

**[Slide 2 — Problem]**
The problem is two payment worlds that don't talk to each other. On one side, Philippine merchants have widely adopted QRPH — the national QR standard — and it lands pesos straight in their bank account. On the other side, people holding crypto like XLM can't spend it at those merchants. The only path today is manual: sell your crypto on an exchange, withdraw pesos to your bank, then go pay. Several apps, several fees, several minutes — and it kills the point of holding crypto for everyday spend. And merchants won't adopt a new system; they already have a working QR. [pause]

**[Slide 3 — Solution]**
HeyPay is the bridge. A payer prefunds their HeyPay wallet with XLM, scans any QRPH code, sees a live conversion rate, and confirms. Behind the scenes we sell that XLM for pesos and pay the pesos into the merchant's registered bank account. The merchant doesn't install anything, change their QR, or learn a new tool. From the payer's side it feels like one-tap payment. From the merchant's side it's just another QRPH payment landing as PHP. [pause]

**[Slide 4 — Demo]**
Here's the whole flow. The payer prefunds with XLM — the balance updates as the deposit clears. They hit Scan, point the camera at a merchant's QRPH code, and HeyPay recognizes it. They enter the amount, see the live rate and exactly how much XLM leaves their wallet, and confirm. The processing overlay shows every step in real time — rate locked, selling the XLM, paying out — until it confirms pesos were sent. Cut to the merchant side: their dashboard shows the settled PHP. One scan, one confirm, done. [pause]

**[Slide 5 — How it works]**
Under the hood it's a web app plus a separate background worker, so the user never waits on the slow parts. We decode the QR to the national standard and match it to a registered merchant. On confirm, we fetch a live rate, lock it, and reserve the exact XLM so it can't be spent twice. A worker then moves the XLM, sells it for pesos through our exchange partner, and pays out to the merchant's bank. Every step is saved and resumable, and if something fails after funds moved, the payer is refunded automatically. [pause]

**[Slide 6 — Where we are today]**
Quick credibility check: this is not slideware. Every flow — payer, merchant, and a full admin console with retry and refund — is implemented and tested today. Fifty-six automated tests plus a four-scenario end-to-end suite run in CI, and we have a containerized deployment config ready to go. Everything that follows is a roadmap on top of a real, running product. [pause]

**[Slide 7 — Impact / market: Philippines]**
Who needs this? Crypto holders who want to spend without the off-ramp dance, and merchants who want crypto-backed payments but won't integrate anything new. The Philippines is the ideal proving ground: QRPH is the national standard, and the country has one of the world's largest remittance corridors plus a fast-growing crypto-holding population. We're not asking merchants to adopt a new app — we plug into the rail they already use. [pause]

**[Slide 8 — Impact on the Stellar ecosystem]**
Here's why this matters for Stellar. XLM's biggest real-world use in the Philippines today is inbound remittance — Coins.ph, Cebuana Lhuillier, MoneyGram, Tempo and Arf all move money INTO the country on Stellar. HeyPay closes the loop: once money's on Stellar, we let people actually SPEND it locally. That's the everyday-spend utility Stellar has been missing — a held balance becoming a real transaction. And it's a template: custodial wallet plus local QR rail plus local off-ramp works anywhere a national QR standard exists. [pause]

**[Slide 9 — Integration roadmap]**
We know how we get from a single-rail MVP to real Stellar infrastructure. Today everything runs through one exchange partner over a plain REST API. Our roadmap: publish a stellar.toml and add SEP-10 auth and SEP-12 KYC; then use SEP-6, 24, 38 and 31 to treat licensed anchors as interchangeable liquidity and to standardize the merchant payout; add USDC to remove volatility; explore the Stellar DEX and path payments as a lower-cost conversion path; and prototype a Soroban escrow contract so funds are provably held on-chain until payout confirms. Our exchange partner has already run Stellar remittance partnerships and hosted a Stellar hackathon — so this is a natural next conversation, not cold outreach. [pause]

**[Slide 10 — Go-to-market]**
Our go-to-market is staged. In the Philippines now, we launch on QRPH and grow through the OFW remittance corridor — letting an overseas relative fund a payer's wallet directly, which makes the market remittance senders and receivers, not just existing crypto holders. Over twelve to eighteen months, we replicate the exact architecture in other APAC markets that have a national QR standard and a licensed local anchor — Thailand's PromptPay, Vietnam's VietQR, Malaysia's DuitNow. Beyond that, once the anchor abstraction is proven in two-plus markets, HeyPay becomes a reusable Stellar-to-local-QR bridge pattern we can take global. [pause]

**[Slide 11 — What's next]**
The next steps that turn this into a licensed, scalable business: real KYC, AML, 2FA and fraud scoring; an explicit, transparent fee model; merchant discovery and recurring payments; native mobile apps; and proactive alerting on top of the health dashboard we've already built. Each is a scoped step, not a wishlist. [pause]

**[Slide 12 — Team / thanks]**
We're [team name]. Thanks to the organizers, the Stellar developer docs, and our exchange partner's public API docs. We'd love to talk to anyone interested in payments, Stellar ecosystem growth, or the Philippine market. Reach us at [contact], and the project is at [URL]. Thanks — we'll take questions.

---

# Q&A guide — anticipated judge / investor questions

> Prep for the room. Answers are grounded in what's actually built (see the repo
> and `README.md`) and in the ecosystem research in **GitHub issue #160**. Keep
> answers tight; lead with the honest version, then the plan.

### Product & technology

**Q1. Is this actually built, or is it a mockup?**
It's built and feature-complete against our spec — payer, merchant, and a full admin console, all working end to end. We have 56 unit/integration tests plus a 4-scenario Playwright end-to-end suite running in CI, and a containerized Railway deployment config. We can demo the whole payer-to-merchant flow live.

**Q2. Custodial wallets — how do you secure user funds and keys?**
Each payer gets a custodial Stellar wallet whose secret key is envelope-encrypted at rest with AES-256-GCM; keys are never stored in plaintext and never touch the client. Auth uses argon2id password hashing, server-side sessions, CSRF protection on every mutating route, rate limiting with lockout, and audit logging. Custody is a deliberate v1 choice for UX; it also makes us a regulated entity, which is why KYC/AML is top of our roadmap (Q13).

**Q3. What happens if a payment fails halfway — say the XLM moved but the peso payout didn't?**
That exact case is handled. Settlement is a persisted, idempotent, resumable state machine (`CREATED → … → SETTLED / FAILED / REFUNDED`). If a step fails after the XLM has left the payer's wallet, the payment branches to a refund path and the payer is made whole. Every state transition is recorded as an event, and an admin can manually retry or refund from the console.

**Q4. How do you handle XLM price volatility during a payment?**
Within a single payment, we lock the XLM→PHP rate for a short window (a rate snapshot) and reserve the exact XLM before settling, so the payer knows precisely what they'll pay. The larger volatility window — between _prefunding_ and _spending_ — is real, and our answer is on the roadmap: add USDC on Stellar as a second custodial asset, which removes crypto-price risk and leaves only the much smaller USD/PHP FX exposure.

**Q5. Why is settlement asynchronous / background rather than instant?**
The slow parts — submitting the Stellar transaction, waiting for confirmation, the exchange trade, and the bank payout — can take seconds to minutes and can fail transiently. A background worker with retries and idempotency means the payer's UI never blocks and the system is resilient to restarts. The payer just watches a live status overlay.

**Q6. How do you decode and trust QRPH codes?**
We parse the QR to the EMVCo national standard (the BSP QRPH TLV format), validate the CRC-16 checksum, and match the decoded merchant identifier to a registered HeyPay merchant. Unregistered codes are rejected with a clear "merchant not on HeyPay" message rather than being trusted blindly.

**Q7. What's your tech stack, and can it scale?**
Next.js (App Router) for web + API, a separate BullMQ worker for settlement, PostgreSQL via Prisma, Redis for queues and rate limiting, S3-compatible object storage, and the Stellar SDK against Horizon. Dashboards are server-rendered with cached aggregates and cursor pagination; external calls have timeouts, retries, and backoff. It's a standard, horizontally-scalable web architecture — the settlement bottleneck is the external rails, not our app.

### Stellar ecosystem

**Q8. You're custodial and use a centralized exchange — is this even really "on Stellar"?**
Today, our on-chain footprint is a classic Horizon payment per transaction — real Stellar settlement, but we don't yet use anchors, the DEX, or Soroban. We're honest about that. Our roadmap is specifically about deepening it: SEP-6/24/31 anchors, USDC, on-chain path payments, and a Soroban escrow contract. The single centralized-exchange dependency is the top risk we're designing away from.

**Q9. What's your actual impact on the Stellar ecosystem?**
Two things. First, we add _real-economy payment volume_ — every HeyPay payment is a genuine Horizon-settled transaction, the kind of volume that supports Stellar's payments thesis rather than trading volume. Second, we deliver the "last mile" Stellar has struggled to demonstrate at consumer scale: turning a held XLM balance into an everyday purchase. The Philippines is already one of Stellar's most active remittance corridors — we extend that from inbound remittance to local spend.

**Q10. Which SEPs will you implement, and in what order?**
Cheap wins first: SEP-1 (`stellar.toml` — makes us discoverable/trusted), SEP-10 (web auth to talk to anchors), and SEP-12 (KYC to a portable standard schema). Then the real unlock: SEP-6/24 to treat multiple licensed anchors as interchangeable on/off-ramps, SEP-38 for standardized quotes so we can rate-shop, and SEP-31 for the anchor-to-anchor merchant payout leg. This is what lets us stop depending on one exchange.

**Q11. Why not use the Stellar DEX / path payments instead of a centralized exchange?**
We plan to explore exactly that. An on-chain `path_payment` (e.g. XLM→USDC) settles in ~5 seconds for sub-cent fees against aggregated DEX + AMM liquidity, reducing counterparty reliance. The honest caveat: we haven't confirmed deep on-chain liquidity for a _PHP-pegged_ Stellar asset, so near-term the DEX is most useful for the XLM→USDC leg, with a licensed anchor handling the final USDC→PHP off-ramp. That's a sequencing decision, not a blocker.

**Q12. Soroban — do you use smart contracts, and why not yet?**
Not yet — there are no contracts in the repo today, and we won't add them for their own sake. The clear use case is an escrow/settlement contract that holds a payer's funds on-chain until the merchant payout is confirmed, which would move refund logic from our servers onto the chain and reduce trust in us. There are strong open-source Soroban escrow patterns (e.g. SwiftRemit, Trustless Work) to start from, plus SDF's audit programs to de-risk it.

### Business, compliance & market

**Q13. You defer KYC/AML — isn't that a fatal problem for a money app?**
It's the single most important pre-production gap, and we treat it as such — it's #1 on the "what's next" slide. Custodial money movement in the Philippines falls under BSP's VASP/e-money rules, so real KYC, AML screening, transaction limits, and 2FA are prerequisites before real money at scale. We're modeling our KYC to the SEP-12 schema from the start so it's portable to any anchor we later integrate. We'd rather show a working payment engine and be honest about the compliance runway than fake it.

**Q14. What's the business model / how do you make money?**
Today the margin is implicit — whatever spread the exchange conversion allows — which isn't a real model, and we say so. The plan is an explicit, transparent fee: a small markup on the quoted rate shown as its own line to the payer, and/or a merchant discount rate in the 1.5–3% range that's standard in card-network economics. Merchant volume tiering and payer referral credits are cheap to add on top.

**Q15. Your margin is a fee on top of the exchange's fee — is that viable?**
It's thin, which is why volume and rail efficiency matter. Two levers improve it: (1) integrating anchors and the Stellar DEX to reduce or bypass a single exchange's spread, and (2) volume — remittance-funded spend is repeat, habitual behavior. We're realistic that this is a scale business, not a high-margin-per-transaction one.

**Q16. How big is the market, really?**
The wedge is the Philippine QRPH + remittance intersection: $38B+ in annual remittances and near-ubiquitous QRPH acceptance. Critically, our biggest market-expansion move (letting overseas senders fund a payer's wallet directly) makes the addressable user base _remittance senders and receivers_, not just the smaller set of people who already hold crypto. A caveat we volunteer: of the trillions in headline stablecoin volume, only ~1% is real payments — we're deliberately in that smaller, harder, real-payments segment.

**Q17. Who are your competitors?**
Directly: the manual off-ramp path (exchange → bank → pay) we replace. Adjacent patterns validate us — Solana Pay and Binance Pay both do "scan QR, pay in crypto, merchant gets settled," and Solana Pay defaults to USDC settlement precisely to dodge the volatility problem we're also solving. On rails, Ripple/XRP and Tron are strong in Philippine remittance corridors, and Celo/MiniPay targets the same emerging-market financial-inclusion positioning. Our edge is being native to the _existing_ national QR rail rather than asking merchants to adopt anything.

**Q18. Why hasn't a big player (GCash, Maya, Coins.ph) just done this?**
They could add pieces of it, but their incentives and rails differ — they're wallets/exchanges, not a neutral bridge that plugs crypto balances into merchants' _existing_ QRPH without merchant integration. Coins.ph is actually a potential partner/anchor for us, not just a competitor. Our bet is on being the thin interoperability layer, and on moving faster on the Stellar-native integration than an incumbent would prioritize.

### Go-to-market & traction

**Q19. Why the Philippines first?**
It's where the two ingredients we need already coexist at scale: a ubiquitous national merchant QR standard (QRPH) and a massive, habitual remittance corridor, plus an active Stellar ecosystem presence. It's the proving ground where the model is easiest to validate before we generalize it.

**Q20. How do you actually acquire users and merchants at launch?**
Merchant side: onboarding is near-zero-effort (register an existing QR + bank account), so the pitch is "accept crypto-funded payments, change nothing." Payer side: we ride the remittance corridor — the wedge is letting an overseas sender fund a recipient's HeyPay wallet directly. For distribution and credibility we lean on partner-led growth: our exchange partner has already run a Stellar remittance partnership and hosted a Stellar hackathon at its Manila HQ, which is a warm channel, not cold outreach.

**Q21. How does the APAC/global expansion actually work — is it a rewrite each time?**
No — that's the point of the architecture. Our payment-rail integration is behind an abstraction, so expanding means swapping two things: the national QR standard (PromptPay in Thailand, VietQR in Vietnam, DuitNow in Malaysia) and the local licensed off-ramp anchor. Once the SEP-6/24/31 anchor abstraction is proven in two-plus markets, HeyPay becomes a reusable "Stellar-to-local-QR" pattern we can license, white-label, or deploy market by market.

**Q22. Are there grants or ecosystem support you can tap?**
Yes, and they're active and PH-localized right now. SDF's Stellar Community Fund offers up to $150K in XLM (Build awards); there are Marketing Grants and Kickstart grants; and there's an APAC-focused Stellar hackathon circuit with events in the Philippines. Pursuing SCF Build for a SEP anchor integration or a Soroban escrow pilot is an explicit parallel track on our GTM slide.

### Risk & defensibility

**Q23. What's your single biggest risk, and what's your honest moat?**
Biggest risk: single-counterparty dependence on one exchange for conversion and payout — if that relationship or API changes, we're exposed. That's precisely what the anchor/SEP roadmap eliminates. On the moat: we're not claiming deep technical defensibility on day one — it's execution speed, the near-frictionless merchant onboarding into an existing rail, regulatory groundwork, and being first to make the Stellar-native, multi-anchor version of this work in the corridor.

**Q24. What would you do with funding / what's the ask?**
Three things, in order: (1) the compliance stack — KYC/AML, 2FA, transaction limits — to move real money legally; (2) the first anchor + USDC integration to kill the single-counterparty risk and prove the abstraction; and (3) go-to-market in the Philippines through the remittance corridor. That sequence turns a working demo into a licensed, defensible, and expandable business. [Tailor the specific amount/runway to your round.]
