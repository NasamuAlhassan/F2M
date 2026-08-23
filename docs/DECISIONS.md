# Decision log

Every significant choice gets an entry: date, decision, reasons, alternatives rejected. Newest entries at the bottom. A milestone is not complete until its decisions are recorded here.

---

## D-001 · 2026-08-23 · V1 is an end-to-end spine prototype

**Decision:** Build the six-step transaction spine (register → match → contract → grade → pay → trace) working end to end and demoable, rather than a backend-only API or a production pilot build.

**Why:** The three unproven things (farmer interviews, one named buyer, one lot moved end to end) all need something demoable. A working spine is the fastest honest artifact — it proves the architecture and gives the field conversations something real to react to.

**Rejected:** Backend-only (nothing to show a buyer or farmer); pilot-ready-first (slower to first demo, blocks on business registration for shortcode and live MoMo).

## D-002 · 2026-08-23 · TypeScript end to end, npm workspaces monorepo

**Decision:** One language (TypeScript) across core domain, server, and web, in an npm-workspaces monorepo (`packages/core`, `apps/server`, `apps/web`).

**Why:** One language means the domain types flow from DB schema to USSD screen to React page without translation. npm workspaces is zero extra tooling on Windows — no pnpm/Turborepo install, works with stock Node 24.

**Rejected:** Python backend (the ML work v1 needs is API calls, not in-process models — no benefit worth a two-language codebase); pnpm/Nx/Turborepo (solves scale problems this repo doesn't have).

## D-003 · 2026-08-23 · Fastify 5 for the server

**Decision:** Fastify as the single HTTP server: REST API, USSD webhook, MoMo callbacks, photo serving, and the USSD tester page.

**Why:** First-class TypeScript, trivial `text/plain` replies for USSD (`CON ...`/`END ...`), official plugins for exactly what we need (formbody for Africa's Talking's form-encoded webhook, multipart for photos, static, jwt).

**Rejected:** Express (weaker TS story, no built-in schema validation hooks); Next.js API routes (couples the API to the buyer portal — but USSD farmers are the primary user and shouldn't ride on a web framework's server).

## D-004 · 2026-08-23 · Drizzle ORM + better-sqlite3 now, Postgres later

**Decision:** SQLite via better-sqlite3 with Drizzle ORM. Postgres is a later mechanical port.

**Why:** Zero-server DB on a Windows dev box; the synchronous driver makes "state transition + trace event in one transaction" trivially safe. Discipline that keeps the port cheap: no SQLite-only SQL, JSON columns as text with Zod-parsed accessors, every query behind a domain service.

**Honest caveat:** Drizzle schemas are dialect-specific — the Postgres move is a half-day port of `schema.ts`, not a config flip.

**Rejected:** Prisma (codegen + heavier runtime for no v1 benefit); raw SQL (loses the typed schema that feeds the whole codebase); Postgres now (an install + a service to babysit before a single lot has moved).

## D-005 · 2026-08-23 · Vite + React SPA for the buyer portal, not Next.js

**Decision:** `apps/web` is a Vite + React 19 SPA (React Router, TanStack Query, Tailwind), talking to the Fastify API via dev proxy.

**Why:** The portal is an authenticated tool with zero SEO needs; SSR buys nothing. The API already lives in Fastify — Next.js would add a second server for nothing.

**Rejected:** Next.js (second server, SSR complexity, no benefit for an authed dashboard).

## D-006 · 2026-08-23 · AI grading on free HuggingFace vision models

**Decision:** Grading calls the HuggingFace router (`router.huggingface.co/v1/chat/completions`, OpenAI-compatible) with a free vision-language model, default `Qwen/Qwen2.5-VL-7B-Instruct`, model swappable by env var. A deterministic mock provider is the dev default and the runtime fallback.

**Why:** User decision — no API spend in v1. The provider interface means Claude/GPT/finetuned models are a one-file swap later. The mock fallback (confidence capped, fallback logged) means a cold model can never kill a demo.

**Rejected:** Claude vision (costs money — revisit when grading quality becomes the bottleneck); running a local VLM (GPU + ops burden on a dev laptop).

## D-007 · 2026-08-23 · USSD via Africa's Talking sandbox + a local tester page

**Decision:** The `/ussd` webhook speaks Africa's Talking's wire format (form-encoded sessionId/phoneNumber/text in, `CON`/`END` text out). Day-to-day dev uses a phone-styled local tester page posting the same payloads; the AT sandbox simulator (via ngrok) is exercised at milestone sign-off.

**Why:** User decision to wire a real gateway. AT's format is the de-facto standard, so the webhook is provider-portable. The local tester removes the tunnel+simulator loop from every dev iteration.

**Rejected:** Hubtel/Nsano first (Ghana-specific, heavier onboarding; AT sandbox is instant — revisit at production when a real Ghanaian shortcode is provisioned); AT-simulator-only dev (slow feedback loop, needs internet + tunnel).

## D-008 · 2026-08-23 · Server-side USSD sessions, last-input-only parsing

**Decision:** USSD state lives in a `ussd_sessions` table keyed by the gateway's sessionId; handlers read only the **last** `*`-segment of AT's cumulative `text` field.

**Why:** Our menus are dynamic (numbered lists of live offers/lots) — they cannot be replayed from the input history the stateless pattern relies on.

**Rejected:** Stateless text-replay parsing (breaks on any dynamic list); in-memory sessions (lost on restart, untestable TTL behavior).

## D-009 · 2026-08-23 · Payments on MTN MoMo sandbox, poll-first, behind an interface

**Decision:** Hold = Collections `requesttopay` at contract acceptance; release = Disbursements `transfer` after grading. Status is **polled**; callback endpoints exist but only trigger a status re-query. A mock provider (with magic failure MSISDNs mirroring MoMo's) is the dev default.

**Why:** User decision to prove the settlement story on real rails. Poll-first because sandbox callbacks are notoriously unreliable, and never trusting callback payloads makes the endpoints idempotent for free.

**Rejected:** Paystack/Hubtel aggregators (real money paths for later; MoMo direct is the rail farmers actually receive on); callback-driven state (flaky in sandbox, trust issues).

## D-010 · 2026-08-23 · Double-entry ledger from day one

**Decision:** Every money movement posts a balanced journal (`external:momo` / `escrow:contract:{id}` / `farmer:{id}:payable` / `buyer:{id}:refunds`). Invariants under test: every journal sums to zero; every terminal contract's escrow is zero.

**Why:** Hold-then-release with grade-dependent final amounts and buyer refunds is exactly the shape where a bag of status booleans silently loses money. The ledger is ~100 lines and makes "where did the pesewas go" a query.

**Rejected:** Status fields on the payment row only (can't represent the refund-of-remainder leg honestly).

## D-011 · 2026-08-23 · Money stored as integer pesewas

**Decision:** All amounts are integers in minor units (pesewas). Formatting to GHS happens at the display edge.

**Why:** The ledger's zero-sum invariant must hold exactly; floats make `0.1 + 0.2` a liability. MoMo takes string amounts anyway.

**Rejected:** Floating-point GHS (rounding drift breaks the ledger invariant).

## D-012 · 2026-08-23 · English-only strings behind a mandatory i18n layer

**Decision:** All user-facing text (USSD screens, SMS, grading reasons, contract terms) resolves through `t(locale, key, params)` from a message catalog. V1 ships `en.json` only. USSD screens return `{key, params}` — the serializer is the only place `t()` is called, so a hardcoded string has nowhere to live.

**Why:** User decision: English now, GhanaNLP's Khaya AI (translation/TTS/ASR) later. Retrofitting i18n into USSD flows is far more expensive than building the seam now. Shipping unreviewed machine translation to farmers would be worse than English.

**Rejected:** Hardcoded strings now, i18n later (the retrofit tax); AI-translated six languages now (no native-speaker review path yet).

## D-013 · 2026-08-23 · Mock-first at every external boundary

**Decision:** Grading, payments, and USSD each have a zero-config simulated mode as the dev default. Real providers are opt-in by env var. `npm run demo` must pass fully offline.

**Why:** No milestone blocks on a sandbox account, a rate limit, or a cold model; failure paths (payment declines, malformed model JSON) are testable deterministically.

## D-014 · 2026-08-23 · Buyer uploads pickup photos in v1 (named simplification)

**Decision:** No field-agent surface in v1. The buyer (or their agent, on the buyer's login) uploads pickup photos on the contract page; the farmer confirms pickup on USSD.

**Why:** An agent app is a whole third surface. The state machine (`PICKUP_CONFIRMED` requires both farmer confirmation and photos) already has the seams for it later.

**Rejected:** Farmer-submitted photos (v1 farmers are on basic phones — no camera path exists by definition).

## D-015 · 2026-08-23 · Prices frozen as a per-grade schedule at offer time

**Decision:** A demand's base price expands into per-band `price_terms` (default multipliers A:1.0, B:0.88, C:0.70, REJECT:0, buyer-editable). The full schedule is frozen onto the contract at offer time and shown in the USSD offer detail. Hold = qty × best band; final = qty × graded band; the delta refunds to the buyer at settlement.

**Why:** The farmer accepts a complete price schedule, not a single number that grading can silently undercut — this is what makes "a grade she can argue with" contractually real.

**Rejected:** Single price + post-grade renegotiation (recreates exactly the farm-gate power imbalance the platform exists to remove).

## D-016 · 2026-08-23 · One shot per (lot, demand) in matching

**Decision:** A declined or expired offer permanently blocks re-offering the same lot to the same demand; freed quantity flows to other lots.

**Why:** Without it, offer expiry → reservation release → rematch produces the identical offer in a loop. The farmer said no or went quiet — respect that; the demand can still be filled elsewhere and the lot can still match other demands.

**Rejected:** Re-offer with backoff (complexity without evidence it's needed at prototype stage).

## D-017 · 2026-08-23 · Demo script drives real HTTP surfaces via fastify.inject

**Decision:** `npm run demo` builds the Fastify app in-process and drives the USSD webhook and REST API through `app.inject()` — no port, no network.

**Why:** It exercises the exact wire surfaces (Africa's Talking form encoding, JWT auth, multipart-adjacent flows) while running offline, never colliding with a dev server on :3000, and staying deterministic enough to gate on exit code 0. A REJECT verdict is retried with a fresh lot up to 3 times and reported honestly.

**Rejected:** Requiring a running server (racy, port-dependent); driving domain functions directly (would skip the wire formats the demo exists to prove).

## D-018 · 2026-08-23 · Market prices are published reference data, not forecasts

**Decision:** A `market_prices` table holds latest-only reference prices per (commodity, market) with an upsert entry point a real feed can call later. Seeded with clearly-placeholder values. Served to everyone: unregistered USSD callers straight from the welcome screen, and a public portal page.

**Why:** The vision claims precisely this and no more — "a farmer knows what her onions fetch in Techiman before she agrees to a number at her gate." Forecasting stays unclaimed until transaction history exists (per the vision doc itself). No registration gate on information: price access is the hook that brings farmers in.

**Rejected:** Price history tables now (nothing consumes history yet); scraping live prices (fragile, and the honest version is "reference data" until a real feed is contracted).

## D-019 · 2026-08-23 · SMS as an outbox, resolved at queue time, delivered by the sweep

**Decision:** Every farmer-facing SMS goes through a `notifications` outbox row: the message text is resolved into the recipient's locale AT QUEUE TIME, delivery happens on the sweep via a `NotifyProvider` (mock offline, Africa's Talking implemented and ready), and failures are recorded on the row.

**Why:** Resolving at queue time archives exactly what was promised to the farmer even if catalogs change later — these messages state prices and amounts. The outbox makes delivery retryable and inspectable (the USSD tester grew an SMS-inbox panel reading it), and mock-first keeps `npm run demo` fully offline (D-013). Hooks fire at the four moments that matter: offer made, funds secured, graded (with the reason), paid — plus an honest rejection message.

**Rejected:** Sending inline at the hook site (a slow SMS API inside accept/grade flows); storing template+params only (re-rendering later could silently change what was "sent").

## D-020 · 2026-08-23 · Paper-terminal design system, component APIs frozen

**Decision:** The visual layer is a flat, light "paper terminal": black (#0A0A0A) on white, hard 1px/2px borders, zero shadows/gradients/rounded corners, dense bordered tables with inverse-ink header rows, monospace tabular numerals for every figure, uppercase tracked section labels, one accent (#15803D) plus sunlight-safe semantic colors (warn #B45309, err #B91C1C, info #1D4ED8), ≥44px touch targets. Tokens live in Tailwind v4 `@theme` (`apps/web/src/index.css`); shared classes and components in `components/ui.tsx`, whose **prop signatures are frozen** — every current and future surface (driver portal, notification bell, IVR tester) restyles through this one file.

**Why:** The addendum's requirement is outdoor readability on low-spec screens — dark themes and low-contrast grays wash out in direct sunlight; decoration costs rendering and communicates nothing. A trading-terminal ledger look also matches what the product actually is.

**Rejected:** Dark terminal green-on-black (fails the sunlight test); light/dark toggle (double the consistency surface — can come later); component API changes during the restyle (would force a page-by-page rewrite instead of a skin swap).

## D-021 · 2026-08-23 · Drivers authenticate with phone + 4-digit PIN

**Decision:** A driver's identity is her phone (E.164, same as farmers). The PIN is set during USSD registration; the web portal exchanges phone+PIN for a JWT with `kind: 'driver'`. One role per phone in v1 (a farmer phone cannot double as a driver phone). One vehicle class per driver in v1 — fleet operators come later.

**Why:** Drivers are phone-first actors; demanding an email would exclude exactly the tricycle operators the middle-mile bridge exists for. PIN parity with buyer password auth keeps it demo-grade and symmetric.

**Rejected:** Email+password for drivers (wrong medium); SMS OTP login (needs live SMS delivery — later); multi-role phones (ambiguous USSD entry screen).

## D-022 · 2026-08-23 · Logistics rides the same ledger with job-scoped escrow

**Decision:** Transport fees post through the existing `postJournal` with new accounts `escrow:job:{id}` and `driver:{id}:payable`, and a nullable `jobId` on payments and ledger entries. `contractId` stays populated on job money, so the contract page's ledger shows produce and transport money in one place.

**Why:** One book, same zero-sum invariants (terminal job escrow must be zero), no parallel money system to reconcile.

## D-023 · 2026-08-23 · Sequential nearest-first dispatch, one live offer at a time

**Decision:** Dispatch offers a job to ONE driver at a time (nearest first by haversine to the pickup), with a TTL (`DISPATCH_OFFER_TTL_MINUTES`, default 10). Declined/expired offers stay blocked per (job, driver) — same one-shot rule as produce matching (D-016) — and the next-nearest candidate gets it. Exhausted → NO_DRIVER, buyer can retry.

**Why:** Broadcast creates double-accept races USSD cannot render and punishes the driver who answers second. Sequential offers reuse semantics the whole system (and its tests) already understand.

**Rejected:** Broadcast-first-wins; driver bidding (a negotiation loop that perishables can't afford).

## D-024 · 2026-08-23 · Transport fee collects at driver accept, not at request

**Decision:** The quote is frozen and shown at request time; the actual MoMo collection fires when a driver accepts (ASSIGNED → FUNDS_HELD via poll), mirroring the produce flow (farmer accepts → hold). Retry-once-then-cancel on funding failure.

**Why:** The buyer is never charged for a job no driver took; symmetry keeps the payment orchestration one pattern.

## D-025 · 2026-08-23 · Driver pickup auto-confirms the produce contract

**Decision:** `confirmJobPickup` transitions the job to PICKED_UP and then, if the produce contract is still FUNDS_HELD, transitions it to PICKUP_CONFIRMED as a system actor (the transition table now allows system there). Sequential transactions — never nested. Defensively, `refundMissedPickups` skips any contract whose job is PICKED_UP or beyond.

**Why:** Goods on a truck ARE the pickup; requiring a second farmer keypress would strand contracts mid-flow. The defensive filter closes the crash window between the two sequential transactions.
