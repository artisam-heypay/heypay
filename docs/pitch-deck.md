# HeyPay — Hackathon Pitch Deck

> One file, one slide per section. Speak to the speaker notes; the slide bodies
> stay minimal. A full read-aloud script for recording is at the bottom.

---

## Slide 1: Title

- **HeyPay**
- Pay any QRPH merchant with your crypto balance.
- Team: **[PLACEHOLDER: team name]**

![Placeholder: HeyPay logo on the cyan/orange brand background, tagline beneath](placeholder-image.png)

**Speaker notes:**
Hi everyone, we're [team name], and this is HeyPay. Our one-liner: let anyone holding crypto pay at any QRPH merchant in the Philippines — and let those merchants receive pesos with zero new integration. QRPH is already everywhere in the country; we just connect it to a balance people already have. In the next few minutes I'll show you the problem, a live demo, and where this goes next.

---

## Slide 2: Problem

- Two payment worlds that don't talk to each other:
  - **Merchants** — millions of Philippine businesses accept **QRPH** (the national QR standard), settled to their PHP bank account.
  - **Crypto holders** — people holding XLM have **no way to spend it** at those merchants.
- To pay today, a holder must: off-ramp to PHP on an exchange → withdraw to a bank → then pay via QRPH. Slow, manual, multiple apps, multiple fees.
- Merchants won't integrate anything new — they already have a working QR.

**Speaker notes:**
The core problem is a disconnected pair of worlds. On one side, Philippine merchants have widely adopted QRPH — the BSP national QR standard — which lands pesos straight in their bank account. On the other side, people holding crypto like XLM can't spend it at those merchants. Today the only path is manual: sell your crypto on an exchange, withdraw pesos to your bank, then go pay. That's several apps, several fees, and several minutes — and it kills the point of holding crypto for everyday spend. Meanwhile merchants have no reason to add a new system. HeyPay exists to bridge exactly this gap.

---

## Slide 3: Solution

**HeyPay: pay any QRPH merchant straight from your XLM balance — the merchant gets PHP in their bank, with no new integration on their side.**

- One scan: payer scans the merchant's existing QRPH code (camera or photo).
- Live, locked rate: payer confirms the XLM→PHP conversion before paying.
- Merchant side is trivial: they register their existing QRPH code + their bank account once, and keep receiving PHP as normal.

![Placeholder: side-by-side — payer phone scanning QRPH on the left, merchant dashboard showing PHP received on the right](placeholder-image.png)

**Speaker notes:**
HeyPay is a custodial bridge. A payer prefunds their HeyPay wallet with XLM, scans any QRPH code, sees a live conversion rate, and confirms. Behind the scenes we sell that XLM for pesos and pay the pesos straight into the merchant's registered bank account. The merchant doesn't install anything, change their QR, or learn a new tool — they just register the QR they already display and the bank account they already use. From the payer's perspective it feels like one-tap payment; from the merchant's perspective it's just another QRPH payment landing as PHP.

---

## Slide 4: Demo

The hero flow — payer pays a merchant end-to-end:

1. **Prefund** — payer opens HeyPay, sees their deposit address + QR, sends XLM; balance updates as the deposit lands.
2. **Scan** — payer scans a merchant QRPH code (camera, or upload a photo); HeyPay decodes it and recognizes the registered merchant.
3. **Confirm** — payer sees the merchant, the requested PHP amount, the live rate, the total XLM deduction, and taps Confirm.
4. **Watch it settle** — a live status overlay walks each step (QRPH scanned → rate locked → selling → paying out) until "₱… sent to {merchant}".
5. **Merchant view** — the merchant's dashboard shows the settled PHP, the XLM received, and the transaction in their history.

![Placeholder: animated GIF or screenshot strip of the four screens — Prefund, Scan, Confirm/Processing overlay, Merchant dashboard](placeholder-image.png)

[PLACEHOLDER: Demo video — a 60–90 second screen recording of the full payer happy path (prefund → scan → confirm → live processing overlay → settled), then a 15 second cut to the merchant dashboard showing the received PHP. No audio needed; overlay text narrates each step.]

**Speaker notes:**
Here's the whole flow in one go. The payer starts on their dashboard, prefunds with XLM — the balance updates as the deposit clears. They hit Scan, point the camera at a merchant's QRPH code, and HeyPay recognizes it as a registered merchant. They enter the amount, see the live rate and exactly how much XLM leaves their wallet, and confirm. The processing overlay then shows every step happening in real time — rate locked, selling the XLM, paying out to the bank — until it confirms pesos were sent to the merchant. Cut to the merchant side: their dashboard shows the settled PHP and the transaction in their history. One scan, one confirm, done.

---

## Slide 5: How it works

A web app plus a background worker — the payer never waits on the slow parts.

- **Scan & decode** — the QRPH code is read and validated to the national EMVCo standard (CRC-checked), then matched to a registered merchant.
- **Quote & lock** — a live XLM→PHP rate is fetched and locked for a short window; the exact XLM amount (plus a tiny network fee) is reserved from the payer's balance.
- **Settle in the background** — a job worker moves the XLM, sells it for PHP through our exchange partner, and pays the PHP out to the merchant's bank — each step is persisted, idempotent, and resumable if anything hiccups.
- **Live status** — the payer's screen polls the payment status so the overlay reflects reality; on failure after funds moved, the payer is refunded.

![Placeholder: simple left-to-right flow diagram — Payer phone → HeyPay (decode, lock rate, reserve) → Background worker (convert XLM→PHP, pay out) → Merchant bank](placeholder-image.png)

**Speaker notes:**
At a high level it's a web app the user talks to, and a separate background worker that does the slow money movement. When you scan, we decode the QR to the national standard and match it to a registered merchant. When you confirm, we fetch a live conversion rate, lock it for a short window, and reserve the exact XLM from your wallet so it can't be spent twice. Then a job worker takes over: it moves the XLM, sells it for pesos through our exchange partner, and pays the pesos to the merchant's bank. Every step is saved and resumable, so if the server restarts mid-payment it picks up where it left off — and if something fails after your funds moved, you get refunded. The payer just sees a live progress bar.

---

## Slide 6: Impact / market

- **Who needs this:**
  - **Payers** holding crypto who want real-world spend without manually off-ramping.
  - **Merchants** who want to accept crypto-funded payments but keep receiving plain PHP with no integration.
- **Why it works in the Philippines:**
  - QRPH is the national, bank-settled QR standard — already displayed by merchants nationwide.
  - Large remittance / OFW corridor + a fast-growing crypto-holding population.
- **Why it's a bridge, not yet-another-app:** we don't ask merchants to adopt anything; we plug into the rail they already use.

![Placeholder: a simple market graphic — QRPH adoption on one side, crypto-holders on the other, HeyPay connecting them](placeholder-image.png)

**Speaker notes:**
Who actually needs this? Two groups. First, crypto holders who want to spend their balance on real things without the manual off-ramp dance. Second, merchants who'd love to accept crypto-backed payments but absolutely do not want to integrate a new system, touch crypto, or change how they get paid. The Philippines is a strong fit because QRPH is already the national standard — it's on shop windows everywhere and settles straight to a bank account. Pair that with a large remittance corridor and a fast-growing population holding crypto, and the bridge is the missing piece. The key insight is that HeyPay isn't asking merchants to adopt a new app — we plug into the rail they already use.

---

## Slide 7: What's next

What's built today is a working end-to-end MVP. Logical next steps, grounded in our own spec and TODOs:

- **Admin oversight console** — operators need visibility into users, merchants, and payment health; spec'd in full but not yet built. [inferred from absent `/admin` routes vs. SPEC §5]
- **Stablecoin payments (USDC/USDT)** — the data model already supports it; enabling it removes XLM price volatility for both sides.
- **Real KYC / 2FA / fraud scoring** — currently out of scope for the demo; needed before real money movement.
- **Mobile apps** — today it's responsive web; native apps are the obvious next surface.
- **Production payment-rail wiring + reconciliation** — finish hardening the partner integration, status webhooks, and automated reconciliation. [inferred from spec'd-but-absent webhook route and a `TODO(pdax-reconcile)` in code]
- **End-to-end automated tests** — the full-flow e2e suite is spec'd and deferred.

**Speaker notes:**
What we showed is a real, working MVP — both the payer and merchant sides, end to end. The clearest next steps come straight from our own roadmap. First, an admin oversight console so an operator can see users, merchants, and payment health — it's fully specified but not built yet. Second, stablecoin payments: the data model already supports USDC and USDT, and switching to stable value removes price volatility for both sides. Third, real KYC, 2FA, and fraud scoring — required before any real money movement. Fourth, native mobile apps on top of the responsive web app we have. Fifth, production hardening of the partner rail, status webhooks, and automated reconciliation. And finally, a full end-to-end test suite, which is specified and currently deferred. Each of these is a clear, scoped next step — not a wish list.

---

## Slide 8: Team / thanks

- **[PLACEHOLDER: name]** — role
- **[PLACEHOLDER: name]** — role
- **[PLACEHOLDER: name]** — role
- Contact: **[PLACEHOLDER: email / handle / project URL]**

Thanks to the hackathon organizers, the Stellar ecosystem docs, and the PDAX public API documentation that informed the integration design.

**Speaker notes:**
We're [team name] — [brief intro per member]. Thanks to the organizers for the event, and to the open documentation that made prototyping the payment-rail integration realistic. We'd love to talk to anyone interested in payments, crypto utility, or the Philippine market. You can reach us at [contact], and the project is at [URL]. We're happy to take questions.

---

# Recording script

*Read this straight through for a ~3–4 minute recording. Pauses are marked with `[pause]`.*

**[Slide 1 — Title]**
Hey, everyone. We're [team name], and this is HeyPay. Our pitch in one line: let anyone holding crypto pay at any QRPH merchant in the Philippines — and let those merchants receive pesos with zero new integration. QRPH is already everywhere in the country. We just connect it to a balance people already hold. I'll walk you through the problem, a live demo, how it works, and where it goes next. [pause]

**[Slide 2 — Problem]**
The problem is two payment worlds that don't talk to each other. On one side, Philippine merchants have widely adopted QRPH — the national QR standard — and it lands pesos straight in their bank account. On the other side, people holding crypto like XLM can't spend it at those merchants. The only path today is manual: sell your crypto on an exchange, withdraw pesos to your bank, then go pay. That's several apps, several fees, and several minutes — and it kills the point of holding crypto for everyday spend. And merchants won't adopt a new system; they already have a working QR. [pause]

**[Slide 3 — Solution]**
HeyPay is the bridge. A payer prefunds their HeyPay wallet with XLM, scans any QRPH code, sees a live conversion rate, and confirms. Behind the scenes we sell that XLM for pesos and pay the pesos into the merchant's registered bank account. The merchant doesn't install anything, change their QR, or learn a new tool — they just register the QR they already display and the bank account they already use. From the payer's side it feels like one-tap payment. From the merchant's side it's just another QRPH payment landing as PHP. [pause]

**[Slide 4 — Demo]**
Here's the whole flow. The payer starts on their dashboard, prefunds with XLM — the balance updates as the deposit clears. They hit Scan, point the camera at a merchant's QRPH code, and HeyPay recognizes it as a registered merchant. They enter the amount, see the live rate and exactly how much XLM leaves their wallet, and confirm. The processing overlay then shows every step in real time — rate locked, selling the XLM, paying out to the bank — until it confirms pesos were sent to the merchant. Cut to the merchant side: their dashboard shows the settled PHP and the transaction in their history. One scan, one confirm, done. [pause]

**[Slide 5 — How it works]**
Under the hood it's a web app plus a separate background worker, so the user never waits on the slow parts. When you scan, we decode the QR to the national standard and match it to a registered merchant. When you confirm, we fetch a live conversion rate, lock it for a short window, and reserve the exact XLM from your wallet so it can't be spent twice. Then a job worker takes over: it moves the XLM, sells it for pesos through our exchange partner, and pays the pesos to the merchant's bank. Every step is saved and resumable — if the server restarts mid-payment, it picks up where it left off — and if something fails after your funds moved, you get refunded. The payer just sees a live progress bar. [pause]

**[Slide 6 — Impact / market]**
Who needs this? Two groups. Crypto holders who want to spend their balance on real things without the manual off-ramp dance. And merchants who'd love crypto-backed payments but won't integrate a new system or touch crypto themselves. The Philippines is a strong fit: QRPH is already the national standard, on shop windows everywhere, settling straight to bank accounts. Pair that with a large remittance corridor and a fast-growing population holding crypto, and the bridge is the missing piece. The key insight: we're not asking merchants to adopt a new app — we plug into the rail they already use. [pause]

**[Slide 7 — What's next]**
What we showed is a real, working MVP. The next steps come straight from our own roadmap. First, an admin oversight console for operators — fully specified, not built yet. Second, stablecoin payments — the data model already supports USDC and USDT, and stable value removes price volatility for both sides. Third, real KYC, 2FA, and fraud scoring, required before real money movement. Fourth, native mobile apps on top of the responsive web app we have. Fifth, production hardening of the partner rail, status webhooks, and automated reconciliation. And finally, a full end-to-end test suite. Each of these is a clear, scoped next step — not a wish list. [pause]

**[Slide 8 — Team / thanks]**
We're [team name]. Thanks to the organizers, and to the open documentation that made prototyping the payment-rail integration realistic. We'd love to talk to anyone interested in payments, crypto utility, or the Philippine market. You can reach us at [contact], and the project is at [URL]. Thanks — we'll take questions.