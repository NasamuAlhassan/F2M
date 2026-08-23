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
