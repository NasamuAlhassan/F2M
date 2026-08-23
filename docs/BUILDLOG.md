# Build log

Chronological record of what was built, changed, or edited, and why. One section per milestone; significant mid-milestone changes get their own dated entries. Newest at the bottom.

---

## 2026-08-23 · M0 started — scaffold

- `git init`, monorepo directory tree, root `package.json` (npm workspaces: `packages/core`, `apps/server`, `apps/web`), strict `tsconfig.base.json`, `.gitattributes` (LF everywhere — Windows dev, avoids CRLF churn), `.nvmrc` pinning Node 24 (prebuilds cover better-sqlite3 and sharp, so no native build toolchain needed).
- `.env.example` documenting every key; mock mode deliberately needs zero keys (see D-013).
- `docs/` created: PROJECT.md (vision + MVP definition), DECISIONS.md (seeded D-001…D-015 with everything settled during planning), this file.

## 2026-08-23 · M0 complete — schema, migrations, seed, smoke tests

- `@ftm/core` package: Zod-validated env loader (`config.ts` — boot fails listing exactly the keys missing for the providers selected; mock mode needs none), full Drizzle SQLite schema (16 tables: farmers, buyers, commodities, units, rubrics, lots, demands, matches, contracts, gradings, photos, payments, ledger_entries, lot_events, ussd_sessions, regions), generated SQL migration checked in (`drizzle/0000_*.sql`).
- Domain JSON types behind Zod (`domain/types.ts`): ClockConfig, RubricDoc, PriceTerms (integer pesewas — D-011), score breakdown, grading reasons, `expandPriceTerms` band multipliers.
- i18n layer (`i18n/`): flat `en.json` catalog + `t(locale, key, params)` with English → key fallback; all seed data references `name_key`s, no display strings in the DB (D-012).
- Seed: 16 Ghana regions with centroids (distance fallback for GPS-less farmers), MAIZE/TOMATO/YAM with clock configs (24h/2h/12h offer TTLs), commodity-scoped units incl. informal olonka + basket, full v1 grading rubrics (4–5 criteria each with visual cues + band descriptors), demo buyer.
- Vitest wired at the root (single worker — DB-backed suites serialize); 4 schema/seed smoke tests green.
- **Deviations from plan:** npm resolved newer majors than planned — TypeScript 7, Zod 4, Vitest 4, better-sqlite3 13 — all kept (better-sqlite3 13 ships Windows prebuilds in the tarball; the node-gyp warning during install is a harmless fallback attempt). Zod 4 API used (`code: 'custom'`, exhaustive enum-key records).

## 2026-08-23 · M1 complete — core domain services + REST API

- Domain services in `@ftm/core/domain` (the single implementation both USSD and web adapt over — the feature-parity rule): `farmers.ts` (Ghanaian phone normalization to E.164, registration), `lots.ts` (unit→kg conversion at intake, clock-enforced ready dates — perishables can't forward-list beyond tomorrow, lot codes from an unambiguous alphabet, LOT_REGISTERED trace event in the same transaction), `demands.ts` (window validated against the commodity clock's maxWindowDays, base price expanded to a per-band schedule or explicit priceTerms accepted), `registries.ts`, `buyers.ts`, `trace.ts` (append-only, per-lot monotonic seq, transaction-scoped).
- `DomainError` with stable codes: surfaces map them (REST → HTTP status now; USSD → error line in M2).
- Fastify server (`apps/server`): JWT buyer auth, error handler mapping DomainError/ZodError, routes for auth, registries, farmers, lots (+trace), demands. `runMigrations()` on boot so a fresh checkout needs no manual db step.
- Verified: 17 vitest tests green (unit conversions incl. olonka→kg, phone normalization, price expansion, full API flow: login → farmer → olonka lot → trace shows LOT_REGISTERED → authed demand; clock rejections for perishable forward listing and over-long tomato windows). Live server smoke-tested with Invoke-RestMethod.

## 2026-08-23 · M2 complete — USSD machine, screens, local tester

- `apps/server/src/ussd/machine.ts`: generic screen machine — screens return `{key, params}` i18n texts, the serializer is the only place `t()` runs (D-012 enforced structurally); server-side sessions keyed by the gateway sessionId, last-`*`-segment input parsing (D-008), 5-minute session TTL with restart-at-home, domain errors become terse error lines instead of dead sessions.
- Screens: welcome/register (name → paged region list → district → confirm), home menu with live offer-count badge, sell flow (commodity → commodity-scoped units incl. olonka → quantity → quality band → ready date **gated by the commodity clock**: tomato gets Today/Tomorrow, maize gets Now…1 month → confirm → lot code), my lots (+detail), offers list (empty until M3 matching), payments (empty until M4). All USSD strings added to `en.json` (~60 keys).
- `POST /ussd` route speaking the Africa's Talking wire format exactly (form-encoded in, `CON`/`END` text/plain out) + `public/ussd-tester.html`, a phone-styled page that speaks the same format against the real route — dev needs no tunnel.
- Verified: 23 tests green, including scripted keypress walks (registration with region paging, olonka lot listing checked in the DB at 500kg canonical, perishable ready-choice gating, invalid-input re-render). Live `POST /ussd` + tester page smoke-tested.
- **Deferred to account setup:** one Africa's Talking sandbox simulator session over ngrok (needs the user's AT account; the wire format is already exercised by the tester and tests).
- Fixed while testing: SQLite ASC text sort puts `NORTHERN` before `NORTH_EAST` (underscore > letters) — harmless for users, mattered to the test's keypress script.

## 2026-08-23 · M3 complete — matching engine, offers, contract state machine, sweep

- `state/contractMachine.ts`: the full guarded transition table (OFFERED→…→SETTLED with decline/expiry/funding-failure/dispute/refund paths). Every transition is atomic with its trace event and its lot/demand side effects (reservation release, status moves) in one SQLite transaction. Actor guards: farmers/buyers can only act on their own contracts.
- `domain/matching.ts`: pure scorer (unit-testable) + orchestrator. Weighted score per clock type — perishables weigh distance 0.35 vs storables 0.15; distance via haversine with region-centroid fallback; farmer history Laplace-smoothed from settled vs refunded contracts. Hard filters: commodity, remaining kg, clock compatibility (storables accept pre-harvest forwards, perishables only ±1 day around the window). Greedy allocation with partial lots; quantities reserved at offer time on both sides.
- Matching runs at all three trigger points: demand creation, lot registration, and the 60s sweep (offer expiry per commodity TTL + rematch). `POST /api/dev/sweep {now}` gives tests a deterministic clock.
- Offers ARE contracts in state OFFERED, with the demand's price schedule frozen on (D-015) and hold sized at best band.
- USSD `offer_detail`: buyer, quantity, **price-per-grade table**, pickup window, expiry countdown, accept/decline — accept and decline call the same domain functions any surface would.
- API: demand detail now returns ranked matches with score breakdowns and contract states; `GET /api/contracts/:id` (buyer-guarded) returns contract + lot + farmer + payments + full trace.
- **Design decision while building (extends D-*)**: one shot per (lot, demand) — a declined or expired offer never re-offers the same lot to the same demand; freed quantity flows to other lots. Prevents an offer→expire→identical-offer loop.
- Verified: 31 tests green — scorer fixtures (perishable decay, band scoring, Laplace history, clock hard filter incl. pre-harvest forward), offer lifecycle (reserve→accept / decline-restores / expiry-restores-without-relooping), wrong-farmer guard, USSD end-to-end offer accept with the price table rendered on-screen and the hold amount checked in the DB.

## 2026-08-23 · M4 complete — payments, double-entry ledger, MoMo provider

- `providers/payment/`: `PaymentProvider` interface (hold/status/disburse/status, keyed by our UUID reference); **mock provider** (dev default, configurable settle delay, magic MSISDNs `…0000` fails / `…0001` sticks pending, mirroring MoMo sandbox test numbers); **MoMo sandbox provider** (per-product token caching ~55min, pesewas→decimal-string wire amounts, EUR settlement currency recorded on the contract, 409-duplicate treated as pending for idempotency).
- `domain/ledger.ts`: balanced-journal postings (`postJournal` refuses unbalanced input), account helpers (`external:momo`, `escrow:contract:{id}`, `farmer:{id}:payable`, `buyer:{id}:refunds`), invariant helpers under test: every journal sums to zero, every terminal contract's escrow zeroes.
- `domain/paymentFlow.ts`: hold at acceptance (`acceptOfferAndHold` — the USSD accept now transitions AND initiates the Collections hold); **poll-first** status resolution (`pollPaymentsOnce` is the only place payment status moves contract state — MoMo callbacks just trigger an immediate poll of one reference); failure handling with one fresh-UUID retry then CANCELLED; hold timeout (`PAYMENT_TIMEOUT_MS`); `releaseDuePayments` (dispute window from config) + idempotent `initiateRelease`; `refundHold` posting the full-refund journal atomically with CANCELLED_REFUNDED.
- Ledger postings ride INSIDE the state transition transaction via a new `also(tx)` hook on `transitionContract` — no crash window between state and money.
- USSD machine converted to async `handleInput` (payment initiation needs it; grading will too).
- Server: two sweep lanes (60s expiry/rematch/releases, 5s payment poll), MoMo callback routes (PUT+POST, payload never trusted), `momo-provision.ts` script for the sandbox API-user dance.
- Verified: 35 tests green — hold journal balanced at FUNDS_HELD; magic-MSISDN decline → FUNDING_FAILED → auto-retry → CANCELLED with reservations released and zero escrow; settle path releases graded amount to farmer + refunds the remainder to buyer with escrow zeroing; full-refund path after funding. Test isolation note: fixtures cancel stray open yam demands + withdraw leftover yam lots — cancelled contracts revive their demand and release their lot by design, which is correct in production and noisy in tests.

## 2026-08-23 · M5 complete — photos + AI grading + disputes

- `providers/grading/`: `GradingProvider` interface with a Zod output schema **bound to the rubric** (band must be one of the rubric's bands, criteria must be rubric keys); `extractJson` (fence-stripping, balanced-brace scan, string-aware); **HF provider** via the OpenAI-compatible router — system prompt embeds the rubric verbatim (visual cues + band descriptors) with a literal example JSON, one repair round-trip on invalid output, exponential backoff on 429/503/500; **mock provider** deterministic from image-bytes hash with reasons quoting the real rubric; `gradeWithFallback` drops to mock with confidence capped at 0.4 and the failure recorded — a cold free model can never kill a demo (D-006).
- `domain/photos.ts`: sharp resize ≤1024px JPEG (storage hygiene + HF payload slimming), EXIF rotation respected, posix paths (they become URLs), PHOTO_ADDED trace in-transaction. `domain/gradingFlow.ts`: pickup confirmation, grading gated on ≥1 photo, **rubric version pinned across dispute re-grades**, grade → frozen-price-schedule → final amount, REJECT → immediate full refund, dispute window enforcement, one final re-grade, farmer "agree" for instant release.
- Server: multipart photo upload + `/photos/` static serving, buyer routes for confirm-pickup and run-grading, contract detail now carries photos + gradings with parsed reasons.
- USSD lot detail became the farmer's action center: FUNDS_HELD → "Confirm pickup done"; GRADED → grade + payout + **the model's reason on screen** + Agree (instant payout) / Dispute (final re-grade). The grade is a number she can argue with, on a Nokia.
- Verified: 46 tests green — JSON extraction edge cases; HF repair round-trip + backoff + rubric-bound schema rejection (stubbed fetch); full flow photo→grade→agree→SETTLED with balanced ledger; dispute→re-grade-final with pinned rubric; REJECT→refund with lot back on the market; and the complete USSD parity walk (pickup confirm, grade + reason on screen, agree, payment visible in Payments menu).
- **Deviation:** no `demo-assets/*.jpg` fixture files — tests and the demo generate JPEG buffers with sharp instead; real produce photos are only needed when `GRADING_PROVIDER=hf` is exercised live.
- Gotcha fixed: a test farmer's phone ended `0001` — the mock provider's own "stuck pending" magic MSISDN. Use deliberately, avoid accidentally, exactly as D-009 warned.

## 2026-08-23 · M6 complete — buyer web portal, verified live in a browser

- `apps/web`: Vite + React 19 + React Router + TanStack Query + Tailwind v4 SPA behind a dev proxy (D-005). Pages: login; demands list + **New Demand form** (commodity with clock hint, unit-quantity with live kg conversion, min band, base price expanding into an editable per-band schedule labeled "this full schedule is what the farmer accepts"); demand detail with **explainable ranked matches** (score + distance/quantity/history bars + km); contract detail (state banner, frozen price-per-grade table with final-band highlight, photo upload → confirm pickup → run grading actions, grading card with confidence bar + per-criterion reasons, payments + full ledger lines); lot trace timeline rendered straight from `lot_events`. Contract page polls every 4s so payments/grading move live during a demo.
- Server: contract detail now includes ledger lines; `make-demo-assets.ts` generates placeholder produce JPEGs.
- **Verified by driving the real thing in Chrome** (buyer in the browser, farmer via the USSD webhook): login → posted a 500kg maize demand → instant match (score 0.74, explainable) → farmer accepted on USSD with the full price table on screen → FUNDS_HELD with balanced hold journal visible → photo upload + pickup confirm + grading. The mock grader's hash rolled **REJECT** on the first photo — the system did exactly the right thing live: CANCELLED_REFUNDED, refund journal on screen, lot back on the market. Round two: new demand → accept → hold → grade **B** → farmer saw "Graded Grade B. Pays GHS 2000.00. Reason: slight dullness…" on USSD and pressed Agree → payout settled → contract SETTLED with the six-line ledger (hold 2,275 / payout 2,000 / remainder 275 refunded, escrow zero) → 17-event trace timeline showing the whole story including the REJECT chapter.

## 2026-08-23 · M7 complete — scripted demo, DEMO.md, README. MVP offline-complete.

- `scripts/demo.ts` (`npm run demo`): builds the Fastify app in-process and drives the whole spine through the REAL wire surfaces via `app.inject()` (D-017) — USSD register with region paging, lot listing in 50kg bags, demand via authed API, USSD accept with the price schedule printed, hold to escrow, photo + pickup + grading, USSD agree, settlement — then prints the 9-event trace and the six-line ledger and exits 0 only if SETTLED with zero escrow and balanced journals. REJECT verdicts retry with a fresh lot (max 3), honestly reported. A janitor cancels lingering open maize demands per attempt (refunded contracts revive their demand by design).
- `DEMO.md`: the scripted demo, the two-tab manual walkthrough, real-provider switches, and the AT-sandbox-over-ngrok procedure. `README.md`: quickstart, layout, provider table, pointers into `docs/`.
- Fixed while building: `listUnits` had no ORDER BY — SQLite's index scan returned units alphabetically by code, so USSD menu numbering depended on query-plan luck. Now explicitly ordered (deterministic menus; maize lists BAG_100KG, BAG_50KG, OLONKA).
- Suite: 46 tests green + demo green after the change.
- **MVP status:** criteria 1 (offline demo to SETTLED) and 3 (two-tab manual demo) are met. Criterion 2 (same demo on real HF + MoMo sandbox) is code-complete but needs the user's accounts: HF token, MoMo sandbox subscriptions + `npm run momo:provision`, AT sandbox + ngrok for the USSD leg.

## 2026-08-23 · M8 complete — lifecycle sweeps finished, trace polish

- Two real gaps in the clock story closed: `expireDemands` (delivery window closed → status expired; the state-machine side effects were already guarded against resurrecting expired demands) and `refundMissedPickups` (FUNDS_HELD with no pickup confirmation by window end + 24h grace → full refund via the existing CANCELLED_REFUNDED path, produce back on the market, and it counts against the farmer's matching history — the same Laplace stats the scorer already reads).
- Both wired into the 60s sweep; `POST /api/dev/sweep {now}` reports the new counts for deterministic tests.
- Trace polish: `PAYMENT_RELEASED` now fires when a payout is initiated (distinct from SETTLED — "your money is on the way" vs "done"), and `DISPUTE_RESOLVED` fires when a re-grade closes a dispute. Both event types existed in the enum and the web timeline's styling since M0/M6; they just never fired.
- Verified: 49 tests green — demand expiry, missed-pickup refund honoring the grace period with balanced books, and a full dispute→re-grade→settle run asserting the complete event sequence ends DISPUTE_OPENED → DISPUTE_RESOLVED → PAYMENT_RELEASED → SETTLED.

## 2026-08-23 · M9 complete — commodity expansion: rice, groundnut, pepper, onion, plantain

- Five new commodities seeded — each is exactly what the architecture promised: a clock, a unit list, a rubric. No platform code changed to add them. Highlights: groundnut's mould criterion instructs the grader to reject strictly on visible mould (aflatoxin risk); onion gets an intermediate perishable clock (12h offers, 7-day windows — it stores, but not like maize); rice quotes in 25kg/50kg bags and a lighter 2.2kg olonka; plantain moves in 12kg bunches on a 4h offer clock.
- New `commodities.sort_order` column (migration 0001) — USSD menus and portal dropdowns list most-traded first (maize, tomato, yam, then wave 2) instead of alphabetically, which keeps existing menu keypresses stable and matches how a farmer expects the list to read. Seed upserts sort order on existing DBs.
- **Bug found and fixed:** `npm run db:seed` had been a silent no-op since M0 — `seed.ts` only exports the function; running the file directly executed nothing. New `run-seed.ts` runner applies pending migrations then seeds idempotently. (`db:reset` was never affected — it always called `seed()` properly, which is why every earlier milestone still seeded correctly.)
- New registry-coherence suite: for EVERY commodity — catalog name resolves, ≥1 unit each with catalog label and positive kg, active rubric parses with a label and full band descriptors per criterion, clock consistent with category (perishables never forward, grains always storable). This is the test that keeps "adding cashew or shea means writing a rubric" honest.
- Verified: 82 tests green.
