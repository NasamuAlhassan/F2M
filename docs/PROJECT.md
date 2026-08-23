# Farm to Market

**A national marketplace connecting Ghanaian farmers to verified buyers, built so a farmer with a basic phone can use every part of it.**

## The problem

Ghana grows enough food and loses too much of it between harvest and consumer: up to 60% of yam, 30–50% of fruits and vegetables, 5–70% of maize depending on district. A loss rate that swings from 5 to 70 percent for the same crop is not a law of physics — it is a coordination failure, and coordination can be fixed with software.

Two people need each other and cannot find each other on terms either can trust. A farmer harvests without knowing who will buy, at what price, on what day — so she sells fast at the farm gate for whatever is offered. A buyer needs known quantity at known quality on a known date and cannot get it reliably from smallholders — so she pays for layers of aggregators or imports instead. Both behave sensibly. Neither holds the information the other needs.

## The product

One **transaction spine**, commodity-agnostic and national:

> **register → match → contract → grade → pay → trace**

A buyer posts demand (commodity, quantity, quality band, delivery window, price, location). The system matches it against registered lots. Matched farmers receive a contract offer on their phone and accept or decline. At pickup the produce is photographed and AI-graded; the grade sets the final price against agreed terms. Payment settles to mobile money — held at contract acceptance, released on verified pickup. The lot carries a record from farm to buyer.

**Two doors, one spine, no second-class user:**

- **USSD** for farmers on basic phones — register, list a lot, accept a contract, confirm pickup, get paid. No internet, no app. Feature parity with the smartphone surface is a hard rule, not a fallback.
- **Web** for buyers, aggregators and logistics — order management, live lot status, quality history, traceability.

**Three registries make it commodity-agnostic:**

1. A **grade rubric** per commodity (grains: moisture, broken kernels, foreign matter, mould; perishables: size, colour, bruising, rot, firmness; tubers: damage, sprouting, rot). Adding a commodity means writing a rubric, not rewriting the platform.
2. A **unit registry** per commodity — canonical kg stored, local units (bags, crates, tubers, bunches, olonka, bowls) displayed.
3. A **clock** per commodity — storables (maize, rice, groundnut) allow forward contracts; perishables (tomato, pepper, okra) route through same-day/next-day matching with the nearest buyers.

**Where the AI sits (claimed precisely):** grading is real and runs (photo → vision model → grade + confidence + reasons, disputable by the farmer); matching is real (scored on commodity, quantity, quality band, distance, window, farmer history). Demand forecasting is **not** built and not claimed — it needs transaction history that won't exist until the platform runs.

**Language is the access layer:** the platform architecture is multilingual from day one. V1 ships English; Twi, Ewe, Dagbani, Ga and Hausa arrive via GhanaNLP's Khaya AI (translation, TTS, ASR) once the flows are stable. A contract a farmer cannot read is a contract she should not sign.

## MVP definition

The MVP is **one lot moved end to end**: a farmer registers and lists a lot through USSD, a buyer posts demand on the web portal, the system matches them, the farmer accepts a contract with a per-grade price schedule on her phone, buyer funds are held, the lot is photographed and AI-graded with reasons both sides can read, payment releases to mobile money, and the whole journey is traceable on one timeline.

### In the MVP

- The six-step spine for **3 commodities** spanning every architecture case: MAIZE (storable grain), TOMATO (perishable), YAM (tuber).
- **USSD at feature parity** — Africa's Talking sandbox webhook + a local browser tester.
- **Buyer web portal** — login, demands, matches, contract detail (photos, grading, payments), lot trace timeline.
- **Real AI grading** via free HuggingFace vision models, with a deterministic mock fallback.
- **Real payment rails** via MTN MoMo sandbox (Collections hold, Disbursements release), with a mock ledger fallback.
- **Double-entry ledger** (every journal sums to zero) and an **append-only trace** per lot.
- All user-facing text behind an i18n catalog (English only for now).

### Deliberately out (and why)

| Cut | Reason |
|---|---|
| Demand forecasting | Needs transaction history that doesn't exist yet — we don't claim what doesn't run |
| Ghanaian language content | Architecture is ready; bad machine translation shown to a farmer is worse than English. Khaya AI integration comes after flows stabilise |
| Field-agent app | Buyer uploads pickup photos in v1; the state machine already has the seams for an agent surface |
| Cold storage / logistics / green layer | Marketplace revenue funds infrastructure later — traffic first, then the cold room the traffic justifies |
| Production telco shortcode + live MoMo | Needs business registration; the sandboxes prove the flow end to end |
| Farmer KYC beyond phone number | Pilot-stage concern, not prototype-stage |

### MVP is done when

1. `npm run demo` drives the full spine to SETTLED **offline** (mock providers) and prints the trace timeline + balanced ledger.
2. The same demo passes with **real** HF grading + MoMo sandbox money movement.
3. The two-tab manual demo works live: USSD tester as the farmer, portal as the buyer, one lot end to end.

## Current status

| Milestone | State |
|---|---|
| M0 — scaffold, docs, schema, seed | **done** |
| M1 — core services + REST API | not started |
| M2 — USSD machine + tester | not started |
| M3 — matching + contracts | not started |
| M4 — payments + ledger | not started |
| M5 — photos + grading | not started |
| M6 — buyer portal | not started |
| M7 — settlement + scripted demo | not started |

_Update this table at every milestone. Last updated: 2026-08-23._
