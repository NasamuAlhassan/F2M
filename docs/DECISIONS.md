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

## D-020 · 2026-08-23 · Paper-terminal design system, component APIs frozen — SUPERSEDED by D-028

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

## D-026 · 2026-08-23 · Buyer notifications are a separate table from the SMS outbox

**Decision:** `buyer_notifications` is its own table (buyerId + read/unread semantics + entity refs), not a channel on the SMS `notifications` outbox. Messages resolve at queue time like SMS; fan-out hooks live in core domain right beside the existing `queueSms` calls (offer accepted/declined/expired, funds held, graded/rejected, driver assigned, in transit, no-driver, driver paid, settled).

**Why:** The two tables answer different questions — "was this delivered to a phone?" vs "has this buyer seen this?". Forcing them into one schema muddles both.

**Rejected:** A `channel` column on the outbox (read-tracking and delivery-status semantics collide); real Web Push (service workers + VAPID for marginal gain — the portal already polls).

## D-027 · 2026-08-23 · Dedicated IVR module, not USSD-machine reuse — same i18n law

**Decision:** Voice flows live in their own small engine (`apps/server/src/ivr/`): `IvrNode {guard?, say, onDigits}` bound to one outbound call and one contract, speaking Africa's Talking Voice XML (`<Say>`/`<GetDigits>` + `dtmfDigits` callbacks), with a per-call node cursor on `voice_calls` (no session table). The D-012 principle carries over verbatim: nodes return `I18nText[]`; the XML serializer is the only place `t()` runs. Calls queue in `voice_calls`, are placed by the sweep via a `VoiceProvider` (mock offline, AT Voice implemented), retry once, and record outcomes as `VOICE_CALL` trace events. SMS remains the unconditional fallback — an unanswered call costs the farmer nothing. Khaya TTS in Ghanaian languages later swaps the provider, not the flows.

**Why:** The USSD machine assumes inbound dials, role-dependent entry screens, and CON/END text; outbound calls are 2–3 nodes with a bound context. A generic engine buys nothing at this size, and the `guard` hook (say-and-hang-up when the flow is moot) fell out naturally under test.

**Rejected:** Reusing the USSD screen machine with a voice transport (impedance everywhere: entry logic, session keying, pagination idioms); full IVR parity with all USSD menus (the offer/grade calls are the killer feature; menus can come with Khaya).

## D-028 · 2026-08-23 · Revert to the original soft design (supersedes D-020)

**Decision:** At the user's request, the brutalist paper-terminal skin is reverted and the ORIGINAL design system restored: rounded cards with soft shadows on a stone-100 ground, the green-900 header, pastel pill state badges, and rounded green buttons. Everything built after the redesign keeps working and was restyled into the original language: the driver login/jobs pages, the buyer transport panel, the Alerts bell, the Request-call button, and the IVR tester (now matching the USSD tester's dark handset aesthetic). The `STATE_COLORS` pill map was extended with the delivery-job and payment states, and the `tableCls/thCls/tdCls/numCls` exports survive with soft styling so post-redesign pages needed no API changes.

**Why:** The owner's call on their own product's look. D-020's one enduring lesson carries forward regardless of skin: component APIs stay frozen through any restyle, which is exactly what made this reversal a skin swap rather than a rebuild.

**How:** Pre-redesign files restored verbatim from git (index.css, Login, Demands, DemandDetail, Prices, ussd-tester); files that gained features after the redesign (Layout, ContractDetail, Trace, ui.tsx) were merged by hand; born-after files (DriverLogin, DriverJobs, ivr-tester) restyled.

## D-029 · 2026-08-23 · Simulation-grade multilingual catalogs and demo-gated acceptance

**Decision:** Twi, Ewe, and Dagbani catalogs exist as MACHINE-DRAFTED subsets (commodities, bands, the offer SMS, the offer IVR script) powering the Engine page's Voice & SMS Simulation Drawer only. Each carries a `_note` in the file and a visible review banner in the UI; no farmer's `locale` is ever set to them until native-speaker review (the Khaya AI integration path). Missing keys fall back to English. Separately, the Engine page's "Accept Contract" demo button calls `/api/engine/simulate-accept`, which is **hard-gated to mock payment mode** — in any real deployment only the farmer accepts, via USSD or IVR.

**Why:** The user asked to SHOW what a Twi/Ewe/Dagbani farmer receives when an auto-match fires — a simulation display, which is exactly the boundary the earlier language decision drew (D-012: unreviewed machine translation must never be farmer-facing). The demo-accept gate keeps the consent model intact: a buyer can never accept on a farmer's behalf where money is real.

**Rejected:** Full catalog translation now (huge unreviewed surface); ungated simulate-accept (breaks the consent model the whole spine is built on).

## D-030 · 2026-08-24 · Adopt the owner's Figma design system (supersedes D-028's skin)

**Decision:** The visual layer now follows the user's own Figma prototype (`Farm to Market UI_UX Design`) wholesale. Tokens: deep forest green `#1B4332` primary, `#14532d` sub-nav band, amber `#D97706` accent, `#F3F4F6` ground; Inter for text and JetBrains Mono (`.mono`) for every number, code, phone, and price. Idioms carried over from the prototype's frames: white `rounded-xl border-gray-100 shadow-sm` cards with tiny uppercase tracked titles; the h-16 dark-green header with the amber "F2M" logo tile and "Agritech Marketplace · Ghana" subtitle over a `#14532d` sub-nav with amber active-tab underline; pill state badges with `pulse-dot` on live states (with reader-friendly labels like "Escrow Held", "En Route"); solid grade tiles (A green-700 / B amber-600 / C red-600 / R gray-800); big-number-tiny-caption `Stat`s on dispatch rows; crop and vehicle emoji as row iconography; gray-50 table header bands; the amber-gradient "AI Match Found" banner with an animated SVG score ring; the six-step transaction-spine stepper with a glow on the active step; and the Nokia-style handset with the `#8B9A3C` LCD for both simulators. Component APIs in `ui.tsx` stay frozen (the D-020/D-028 rule) — this was again a skin swap, not a rebuild; `GradeBadge` and `Stat` are additive exports.

**Why:** The owner designed exactly what they want in Figma and handed over the code export as the reference. Matching a concrete prototype beats iterating on taste by prose.

**Rejected:** Cherry-picking only some frames (a half-adopted design system reads as inconsistency); introducing the prototype's mock-data frames as pages (seller dashboard, QR card, co-op view are design references, not built features — they come when their features do).

## D-031 · 2026-08-24 · Marketplace browse view — a "bid" is a pre-filled demand

**Decision:** The prototype's Frame 01 (browse Active Commodity Lots as cards with filters and search) is now a real page, built entirely on existing machinery. `GET /api/market/lots` is read-only: open lots joined with farmer, unit, region, distance from the buyer (haversine), and a price — the lot's `asking_price_per_kg` when set, else the commodity's cross-market reference average, labeled "market ref" on the card. **"Place Bid" opens the existing demand form pre-filled from the lot** (commodity, unit, remaining units, declared band, reference price); posting it runs the normal demand → engine → offer → farmer-consent flow. Card art is a brand-styled crop gradient + emoji — farmers list over USSD from basic phones, so no lot photos exist and none are faked. The header's language switcher shows English active and Twi/Ewe/Dagbani/Hausa visibly disabled (tooltip: awaiting native-speaker review) — the portal's own strings are not i18n-wired, and D-012/D-029 forbid shipping machine-drafted text as if reviewed.

**Why:** Buyers think in "browse and bid"; the platform's consent model is "offer and the farmer accepts". Pre-filling a demand gives buyers the browsing mental model without inventing a second negotiation path that bypasses farmer consent, price-schedule freezing, or the one-shot match rule. The form's perishable-window snap (end date clamps to the commodity's clock) fell out of this — pre-filling a perishable surfaced the invalid default.

**Rejected:** A separate `bids` entity with farmer-side accept (duplicates matches/contracts wholesale); stock-photo or AI-generated produce imagery (misrepresents the actual lot); enabling the unreviewed locales on the switcher.

## D-032 · 2026-08-24 · Farmer web login = phone + OTP over the SMS outbox; the portal is a parity surface

**Decision:** Farmers get the web Seller Dashboard (prototype Frame 07) without touching USSD registration: `POST /auth/farmer-otp` writes a 6-digit code (bcrypt-hashed, 10-min expiry, 5 attempts, one live code per phone — `login_otps`, migration 0008) and queues `sms.loginCode` through the existing SMS outbox; `POST /auth/farmer-login` exchanges phone+code for a `kind:'farmer'` JWT with its own `authFarmer` guard. Offline, the code is visible in the USSD tester's SMS inbox; with AT keys it is a real text. Every portal action is the same domain call the USSD tree makes: `registerLot` (now with the web form's optional ask price), `acceptOfferAndHold`, `declineOffer`. v1 accepts OTP-request enumeration (a helpful "register by USSD first" error beats a silent no-op for farmers who mistype).

**Why:** Farmers are phone-first with no passwords or emails; an OTP over the channel they already receive rides existing rails and stays mock-first. The parity principle (USSD = web = IVR over one domain layer) extends to a third farmer surface for free.

**Rejected:** Adding a PIN step to USSD registration (changes a tested flow for a web-only need); passwords (wrong medium); silent OTP no-op on unknown phones (hostile to the actual failure mode).

## D-033 · 2026-08-24 · Traceability QR resolves to a public capability URL with a whitelisted payload

**Decision:** Each lot's certification QR (prototype Frame 09, real QR via the `qrcode` lib) encodes `/t/:lotId` — a public, unauthenticated page backed by `GET /api/public/trace/:lotId`. Lot ids are unguessable UUIDs, so the URL itself is the capability. The public payload is whitelisted **per event type** (kg, bands, confidence, distance); phone numbers, MoMo details, and every money amount are never serialized. The buyer's Traceability page renders the same public data beside the QR — what you preview is exactly what a scanner sees. The prototype's blockchain rows become the honest equivalent: the append-only `lot_events` record, linked, with the payment's provider reference on the contract page.

**Why:** Traceability that needs a login is marketing, not traceability — the QR's whole point is that a market inspector or consumer can scan it. Whitelisting per event type makes privacy a property of the endpoint, not a hope about payload contents; the test asserts no phone and no `amount` ever appear.

**Rejected:** Authenticated trace links (defeats the purpose); publishing raw trace payloads (leaks prices and phones); a blockchain pastiche (we have a real append-only log — claiming chain writes we don't do would be dishonest).

## D-034 · 2026-08-24 · Co-op consolidation = one pool demand; the engine already splits it

**Decision:** The Consolidation Board (prototype Frame 10) lets a buyer select same-crop lots against a chosen truck's capacity (real vehicle classes, overload guarded, 80%+ = good load) and post **one pool bid**: a single demand sized to the selected kilograms via the existing `quantityKg` path, min-band = the lowest declared band selected, window clamped to the tightest perishable clock in the pool. No new write paths: the matching engine already allocates one demand across many lots, so each farmer in the pool receives — and individually accepts or declines — their own offer, and transport dispatches per contract as always.

**Why:** The prototype's "auto-assign driver & dispatch" button, taken literally, would move other people's produce without their consent. Mapping consolidation onto a pool demand keeps the consent model, escrow flow, and one-shot match rule intact while delivering the actual value: small lots aggregating into a truck-sized order.

**Rejected:** A consolidation entity that locks member lots and dispatches directly (bypasses farmer consent and duplicates matching); buyer-side multi-lot contracts (the demand already expresses exactly this).

## D-035 · 2026-08-24 · Buyer IA consolidates to four destinations

**Decision:** The buyer portal's seven nav tabs collapse to four: **Marketplace** (browse + the Pool Builder as an in-page mode, `?mode=pool`), **Orders** (the demand book and the engine working it — match banner, compact table, demand form in a modal, intent feed), **Contracts** (new compact list; the traceability QR moves onto each contract's detail page), **Prices**. ContractDetail becomes two-column: the flow (transaction stepper, grading, transport, photos) in the main column, a sticky rail with parties/terms, the price schedule, payments (ledger behind a disclosure), and the QR card. Old URLs (`/demands`, `/engine`, `/consolidate`, `/traceability`) redirect — the platform is being deployed and tested live, so no link may die. Shared pieces were extracted, not rewritten: `components/DemandForm.tsx`, `components/engine.tsx`, `components/QrImage.tsx`.

**Why:** The portal grew a tab per milestone; the user's model is one marketplace with an order book and contracts, not seven sibling pages. Destination = a noun the buyer thinks in (things to buy / my orders / my deals / prices); everything else is a mode or a detail of one of those.

**Rejected:** Keeping seven tabs and only densifying pages (the scatter was the complaint); a dashboard/home page of widgets (a fifth place to look, when the four destinations already answer "where do I go").

## D-036 · 2026-08-24 · Listings carry their channel; basic-phone farmers are reached by phone, smartphone farmers by photos

**Decision:** `lots.channel` (`web | ussd | ivr`, migration 0009) records how a listing was made, stamped at each call site. Smartphone sellers upload **listing photos** (reusing the existing `photos` table — `contractId` was already nullable — via `addLotPhoto`/`listListingPhotos`; same sharp pipeline, `PHOTO_ADDED` trace event with `stage: listing`); the marketplace card shows the real photo. USSD/IVR listings keep the crop-gradient placeholder and instead surface the **farmer's phone with a "Call to negotiate" `tel:` button** plus a note that the farmer may not read SMS — shown to authenticated buyers only; the public trace stays phone-free (D-033). Place Bid remains available on every listing: a bid still reaches a basic-phone farmer as a voice call + SMS.

**Why:** The user's model in one sentence: literate sellers show their produce, non-literate sellers are called. The card must tell the buyer which conversation they're walking into. Reusing the photos table avoids a parallel image system; the channel column is the single fact everything else (phone display, badge, placeholder art) derives from.

**Rejected:** A separate lot_photos table (the schema already modeled contract-less photos); showing every farmer's phone (web sellers are reachable in-app; phones are the accommodation, not the default); hiding Place Bid on called listings (the IVR accept flow exists precisely so bids still work).

## D-037 · 2026-08-24 · Direct hire jumps the dispatch ladder once; seller-arranged delivery is buyer-approved

**Decision:** The side-hustle driver marketplace gets two additions on top of D-023's sequential dispatch, with no schema change. (1) **Direct hire**: `requestTransport` takes a `preferredDriverId` — the quote prices that driver's own vehicle (capacity-guarded), and the chosen driver gets the FIRST offer regardless of distance; a decline or TTL expiry falls back to the normal nearest-first ladder, one-shot rule intact. Offline/busy drivers refuse the hire upfront. `GET /api/drivers/available` (buyers and farmers) lists online drivers with vehicle, routes, phone, and a live busy flag — call to inquire, hire to dispatch. (2) **Seller-arranged delivery**: the farmer's "Arrange delivery" writes a `TRANSPORT_SUGGESTED` trace event and a buyer alert with the cheapest quote; the buyer's transport section shows the request and approving runs the unchanged request flow. Nothing dispatches and no money moves until the buyer acts — requester-pays (D-024) stays literal.

**Why:** The user's model has buyers browsing and hiring specific drivers, and sellers arranging deliveries — but the payer is the buyer, so the farmer's arrangement must be a request, not an order. Making preference a dispatch-time argument (not a job column) keeps the fallback ladder and every existing invariant untouched.

**Rejected:** Farmer-pays-from-payout (a new ledger path and the farmer bearing cost pre-payment — deferred until real testing demands it); persisting the preference on the job (it must NOT survive into retries — the fallback is the point); open bidding between drivers (D-023 already rejected negotiation loops perishables can't afford).

## D-038 · 2026-08-24 · The open-ended voice listing: one call, ASR → MT → parse, mock-first

**Decision:** A farmer who can't use menus lists by ONE call to the listing line: `/voice/answer` with no `callId` is the inbound path — it says "tell us everything you want to sell" and `<Record>`s; when the recording lands, the pipeline runs **ASR → MT → registry-driven parser → `registerLot(channel:'ivr')`**, the call reads back exactly what went live, and an SMS receipt archives it. Every call writes a `voice_listings` audit row (migration 0010: audio ref, transcript, translation, parsed JSON, lot id, status, error). ASR and MT are providers (`ASR_PROVIDER`/`MT_PROVIDER`, mock default): the mock ASR returns the transcript the wire supplied (the IVR tester's textarea — the offline demo path), and **Khaya AI (GhanaNLP)** implementations ship ready behind `KHAYA_API_KEY`. The parser is registry-driven (commodity names + a small synonym list, number words, unit-name keywords, quality words → band, default B) with two safety rules: never map a crop we don't carry, and on an ambiguous unit take the SMALLER one — understating a harvest is recoverable, overstating breaks matches. Anything unparseable fails honestly: no lot, the call says so, and an SMS points to the USSD menu path. Unregistered callers are told to register first — we never list produce for a phone we don't know.

**Why:** The user's model verbatim: don't walk a non-literate farmer through tedious prompts — let them speak once and let the pipeline do the rest. Mock-first keeps the whole flow testable offline today (D-013); Khaya on language day is an env swap because the seams are provider interfaces, not code paths.

**Rejected:** LLM-based extraction now (a network dependency and hallucination surface for a task the registry vocabulary covers; revisit when real transcripts defeat the rules); auto-registering unknown callers (name and region matter too much to guess); silently guessing quantities or crops (a wrong listing published under a farmer's name is worse than any failure message).

## D-039 · 2026-08-24 · The Trade Instrument: a security-print visual world replaces the Figma-derived look

**Decision:** The web app's entire visual identity is replaced (owner's explicit request: full redesign, keep only the F2M name + mark) with **The Trade Instrument** — the design grammar of the cedi banknote and the printed trade certificate. One world, held everywhere: tinted banknote paper (`--paper #efebdd`) under a fixed nine-step intaglio-green ink ramp (the only neutral scale), bronze-gold reserved for value figures and the live language, oxide-red for stamps and refusals. Three faces, three voices: **Cinzel** for engraved display capitals, **Public Sans** for working text, **Courier Prime** for serials, money, and timestamps — all self-hosted woff2, no network fonts. Print furniture instead of app chrome: `.certificate` frames (outer rule + inset hairline, square corners), `.plate` ink fields, `.rule-double` ledger rules, tiled guilloché bands, engraved-hatch media wells, `.stamp` rubber-stamp states, double-ring grade seals. All iconography is engraved line art (`engrave.tsx`: crop marks, vehicle marks, glyphs, the 16-petal rosette seal) — no emoji in product UI. One authored motion: the seal lands (`seal-land`), routes ink themselves in (`route-ink`), live states hold a damped gold ember — all reduced-motion guarded. Component APIs in `ui.tsx` stay frozen; every page re-rendered in the world with zero domain or copy changes. The direction contract (seed `222cf785`) lives as a comment in `index.html` and survives the build. Floors from the finish review: 11px minimum for functional text, `--gold-ink`/`--ink-6` contrast-safe smalls, `sellerName()`/`placeName()` guards so raw parser output never prints as a person.

**Why:** The owner's brief verbatim: redesign the whole thing so it does not look AI-generated, premium. The product's own claim — escrow, graded certificates, an append-only trace — already speaks the language of instruments you can trust; borrowing the visual grammar of the one printed object every Ghanaian trader already trusts (the banknote) makes the UI argue the product's thesis instead of decorating it. A committed world with its own furniture, faces, and motion is also the strongest defense against the generic-AI look the owner named.

**Rejected:** Polishing the incumbent Figma look (D-030 — the owner explicitly superseded it; splitting the difference lands in no-world); stock or AI-generated imagery (misrepresents real lots — photo wells show the real photo or an honest engraved hatch); web-font CDNs (an offline demo that loses its faces loses the world).

## D-040 · 2026-08-24 · Language day: the review gate lives inside t(); Khaya drafts the catalogs, TTS speaks them

**Decision:** Six locales ship in the registry — English, Twi, Ewe, Dagbani, Hausa, **Kusaal** — and the D-029 review gate becomes a property of the resolver itself: `t()` serves a non-English catalog only when that locale is **live** (its catalog's `_reviewed` metadata is set by a native speaker, or the owner's `I18N_DRAFT_LOCALES_LIVE` escape hatch is on for live testing). Otherwise every farmer-facing surface resolves from English — while the farmer's `locale` choice is still freely persisted, so a later review flips their language on retroactively with no code change. `tDraft()` is the ungated preview channel, wired ONLY to the simulation drawer and the `/api/i18n/locales` status endpoint. Choosing a language: a brand-new USSD caller gets a `lang_welcome` endonym menu **only when more than English is live** (default flow byte-identical); registered farmers dial home→7 and drivers home→4 (the menu's dead key); the web farmer dashboard and driver profile gain pickers backed by `PATCH /api/farmer/profile` (new `updateFarmerProfile`, mirroring the driver's) — non-live options visibly present but disabled. Pre-registration choices ride `ussd_sessions.ctx` (zero migration; a choice survives its own session, long enough for registration to persist it). Registration and USSD listings now send SMS receipts (`sms.registered`, `sms.lotListed`) — the farmer's written record and the immediate proof of a chosen language. Catalogs are machine-drafted by `npm run i18n:draft` (Khaya MT, free key): placeholders masked as numeral sentinels for the round-trip, `region.*` and pure-placeholder templates copied verbatim, unsupported languages (Kusaal today) probed and skipped, keys whose placeholders don't survive dropped with a report — dropped keys fall back to English at runtime by construction. IVR speech: a mock-first TTS provider (`TTS_PROVIDER`, Khaya behind the same key) synthesizes local-language audio, cached by content hash under `/tts/` and played via `<Play>`; any TTS failure falls open to the English `<Say>` — a broken TTS must never kill a call — and `speechLocale()` guarantees a voice never reads English fallback text in a local voice. The Khaya ASR/MT providers got their first wire tests, which forced two real fixes: object response bodies were being `.toString()`ed into "[object Object]", and locale codes now pass through an explicit `LOCALE_TO_KHAYA` map that fails loudly for languages Khaya lacks.

**Why:** The gate belongs at the single point where text becomes farmer-visible (D-012 already put all resolution in `t()`), not at every write site — gating writes would lose the farmer's preference and touch thirteen call paths. Endonym menus need no translation because language names are self-identifying. Receipts, sentinel masking, and fail-open TTS all follow one rule: a farmer must never receive something we can't stand behind — better honest English than broken Twi, better `<Say>` than a dead call, better a dropped key than a mangled placeholder.

**Rejected:** Gating at `farmer.locale` write time (loses the choice, touches every surface); a `notifications.locale` column (resolution already happens once, at queue time); a `ussd_sessions.locale` migration (the ctx blob suffices for a 5-minute TTL row); LLM-based catalog drafting (Khaya MT is the project's own bet — and the user's field); making `welcome` itself the language menu unconditionally (breaks the demo, tests, and every English-only deployment for zero gain while only en is live).

## D-041 · 2026-08-24 · Provider day: open models via the HF token stand beside Khaya's metered API

**Decision:** Live verification with real keys reshaped three providers and added an alternative rail. (1) **Africa's Talking hosts split by username**: sandbox keys 401 on the production hosts and 201 on the sandbox ones — verified on the SMS wire, applied to SMS and Voice. (2) **The HF grading model moved to the router's living catalog** (`Qwen/Qwen3-VL-30B-A3B-Instruct`; the original 7B VL retired) — a real grading then ran end to end: provider `hf`, 95% confidence, model-authored observations, demo settled on a genuine AI verdict. (3) **`MT_PROVIDER=hf` and `ASR_PROVIDER=hf`** ride the owner's HF token as an alternative to Khaya's quota-metered API: translation by an instruction-following LLM on the router (temperature 0, reply-only prompting, numerals — the draft sentinels included — kept verbatim; `MT_MODEL`, default Gemma-3-27B), transcription by Whisper on hf-inference (`ASR_MODEL`) — strong for English calls, honest-failure SMS for Ghanaian speech until a Ghanaian ASR model lands on a provider. TTS keeps only Khaya/mock: NLLB and MMS-TTS are not deployed on the token's providers (probed live). The draft script picks its engine from `MT_PROVIDER` and stamps it into `_machineDrafted`. Also fixed by the wire: `.env` shortcodes must be quoted (`"*384*7247#"` — an unquoted `#` starts a comment and silently amputated the dial code from every SMS).

**Why:** The user's call, made when Khaya's free quota ran dry mid-draft: the models we need also live on Hugging Face, where one token already pays for grading. Free tiers are for verification, not production — and today verified everything: both quota walls found, both APIs proven working before hitting them, and every failure path (grading fallback, dropped draft keys, honest-failure SMS) behaved as designed.

**Rejected:** Retrying Khaya until the quota resets (23 days of standstill); LLM translation as the ONLY rail (Khaya's dedicated NMT should outdraft a general LLM for Twi when quota returns — both stay, switched by env); scraping-tier workarounds for MMS-TTS (self-hosting audio models is a different project).

## D-042 · 2026-08-25 · The Market World: a second visual redesign, replacing D-039's paper world

**Decision:** The web app's visual identity moved again, at the owner's explicit request, away from The Trade Instrument's cedi-banknote security-print world toward **The Market World**: white cards on a soft green-tinted ground, a bold saturated brand green (`--forest`, was near-black in an earlier undocumented pass) carrying the masthead and every primary action, `rounded-full` pill controls and real cast shadows (reversing the paper world's square-corner/no-shadow rules), and — the biggest single change — **true-to-produce color per commodity** (`cropAccent()` in `engrave.tsx`) replacing one uniform green wash on every card and filter icon. `DESIGN.md` is rewritten from the built world (it had drifted stale, still documenting the retired paper system after an earlier undocumented reskin already moved the code). Dense ledger-table icons stay neutral by design — color is reserved for surfaces where identifying a commodity at a glance is the point, not for every row of a scannable table.

**Why:** The owner judged the paper world's palette, texture, and "basic"-reading polish level against a reference UI they liked (a modern POS product) and asked for that level of vividness and confidence, while keeping F2M's own content and product truth — not a literal reskin into that reference's domain.

**Rejected:** A literal clone of the reference's sidebar-cart-checkout layout (F2M's marketplace is browse-and-bid, not an in-person POS order flow — the existing filter-sidebar + card-grid composition already served the same job); reskinning only the Marketplace page (the gap — flat dark ink primary buttons, monochrome crop icons, a dead `.guilloche` decorative class left over from the paper world — was systemic across the app, not page-local).

## D-043 · 2026-08-25 · Representative crop photography supersedes D-036's icon-only no-photo placeholder

**Decision:** Every commodity now has a real, self-hosted representative photo (`cropPhoto()` in `engrave.tsx`, sourced from Unsplash-licensed and one CC-BY-SA Wikimedia Commons photo — credited in `public/images/CREDITS.md`, downloaded once rather than hotlinked so the offline demo stays offline). It's used in three places: crop-type filter icons and small farmer-dashboard listing thumbnails (pure iconography, no claim about any specific lot); and — reversing D-036's explicit "never a stand-in photo" rule — the Marketplace lot-card media well for USSD/voice-listed lots that have no seller-submitted photo, where it now always carries a **"Representative photo" label** overlaid on the image itself, not just the pre-existing channel badge. The public trace/verification page (`PublicTrace.tsx`) deliberately keeps the old icon-only treatment: that surface's whole purpose is chain-of-custody proof for one specific lot, and a stock photo there — even labeled — sits too close to implying verified evidence.

**Why:** The owner explicitly asked for real photography app-wide, including the no-photo placeholder, after being shown the D-036 rationale (a stand-in photo could read as this farmer's actual produce) and choosing to proceed anyway — their call to make on their own product. The in-image label is the mitigation: keep the honesty the original rule was protecting (a buyer can tell "you're not looking at this farmer's actual crop") without losing the visual richness of a real product photo. Reversing D-042's "no photo" rule felt worth a paper trail rather than a silent code change, matching this file's own established practice.

**Rejected:** Applying the same photo+label treatment to `PublicTrace.tsx` (higher stakes than a browse card — it's the public verification surface, and even a labeled stock photo risks reading as "verified"); AI-generated produce imagery (same misrepresentation problem the original rule was written against, plus PRODUCT.md's standing rule against fabricated imagery); hotlinking the source CDN URLs directly (breaks the offline demo, D-013).

## D-044 · 2026-08-26 · A local-models process fills the one gap Khaya and HF both leave: Kusaal

**Decision:** `ASR_PROVIDER`/`MT_PROVIDER` gain a fourth option, `local`, backed by a new standalone Python process (`local-models/`, FastAPI) that runs open-weight models in-process rather than calling a hosted API — `KhayaAI/w2v-bert-*` (Apache-2.0, unrestricted) for ASR per locale, and the owner's own `PrinceAlhassanNasamu/tekyerema-nllb600m-v1` (gated, CC-BY-NC-4.0) for MT across all five non-English locales in one checkpoint. `LocalAsrProvider`/`LocalMtProvider` in `packages/core/src/providers/{asr,mt}/index.ts` call it over plain HTTP (`LOCAL_MODELS_URL`, default `localhost:8008`) — the identical shape the Khaya and HF providers already use, just pointed at a second local process instead of a third party's server, because Node can't run PyTorch in-process. Model IDs and license/gating status were verified directly against Hugging Face's own API before being wired in, not taken on faith from the source guide.

**Why:** Kusaal has no Khaya code at all (`LOCALE_TO_KHAYA`'s `kus: undefined`) and a generic LLM (the `hf` provider's chat-based translation) is a poor fit for a low-resource language a general model has barely seen. A model fine-tuned specifically for Kusaal, run locally at zero per-call cost, is the only real option — and since it's one extra endpoint on the same service, the other four locales ride along for free.

**Rejected:** Calling these models through a hosted inference API instead of running them locally (defeats the actual ask — free, no external dependency, and some of these checkpoints may not even be supported by a generic serverless inference endpoint); merging the Python process into the Node server via a subprocess bridge per request (a long-lived service that loads each model once is simpler and avoids paying model-load cost on every call); eagerly loading every language's model at startup (lazy-load-and-cache keeps a demo laptop from loading five checkpoints it may never all use in one session).

**Addendum — the handset simulator records real audio.** "Speak a listing" now opens the browser mic (`MediaRecorder`) instead of only accepting typed stand-in text; the clip uploads to a new `POST /voice/upload-recording` (mirrors the existing lot-photo upload — write to `STORAGE_DIR`, serve back by URL, no DB row since a recording is ASR input, not a marketplace asset) and the resulting URL rides through `/voice/answer` as `recordingUrl`, the same field a real Africa's Talking callback carries. This surfaced a real gap in `local-models/server.py`'s `/asr`: `torchaudio`'s only backend here is `soundfile`, which cannot decode WebM/Opus — exactly what `MediaRecorder` produces on every current browser. Every real recording would have failed silently into "Could not decode." Fixed by piping the upload through `ffmpeg` (already required, per the D-038 IVR path) to 16kHz mono WAV before handing it to `torchaudio.load()`, so the decode step accepts whatever codec actually arrives instead of only WAV. The typed-text box stays as a fallback for mic-less testing, now visibly secondary in the UI.

**Also:** `*384*7247#` → Sell produce now offers **8. Or call and speak your listing** on the commodity list's first page — ends the USSD session with the number to call (`AT_VOICE_NUMBER`, or a demo-mode phrase when unset), since USSD and a voice call are genuinely different channels on a real network; there is no way to stay inside a USSD session and start recording audio in the same session. Deliberately not offered past page 0 — a farmer who has already paged through commodities is mid-flow, not looking for the shortcut.

## D-045 · 2026-11-13 · The owner's own language Space becomes a provider: one service that hears, translates and speaks

**Decision:** `ASR_PROVIDER`, `MT_PROVIDER` and `TTS_PROVIDER` each gain a `space` option backed by the owner's public Hugging Face Space (`PrinceAlhassanNasamu/tekyerema-lang`, host in `SPACE_URL`). It is a Gradio app, so `providers/space.ts` speaks its two-step REST dialect (`POST /gradio_api/call/<endpoint>` → event id → `GET` the event stream) with plain fetch — no key, no SDK. Hearing sends the recording as base64 to `asr_b64`; translation calls `translate` and treats `covered:false` as a failure, never as a translation; speech calls `tts`, caches the WAV by content hash under `/tts/` exactly like the Khaya clips, and answers `null` (→ `<Say>`) for English and on any failure. F2M locales map to the Space's codes in `LOCALE_TO_SPACE` (`en→eng, tw→twi, ee→ewe, ha→hau, kus→kus, dag→dag`); a locale it lacks (Ga) fails loudly. `MT_PROVIDER=space npm run i18n:draft` drafts catalogs with it. The review gate (D-040) is untouched: a locale is still English on every farmer-facing surface until a native speaker signs its catalog off.

**Why:** The owner's own recognisers, voices and NLLB translator (v3) are the only stack that covers Kusaal and Dagbani end to end, and they were not reachable from F2M at all — the repo only ran the older v1 translator through `local-models/`. One keyless service replaces three separate provider setups for the demo.

**Consequences worth knowing:**
- *The Space reads audio with libsndfile, which cannot open WebM*, and browsers record WebM. The handset simulator now re-encodes the recording to 16 kHz mono WAV in the browser (`apps/web/src/lib/wav.ts`) and `/voice/upload-recording` keeps the container it was sent. A WebM that still reaches the provider is refused with a plain message instead of a model's decode error.
- *Cold starts.* The Space sleeps after ~2 days idle and loads each language on first use (English hearing measured 33 s cold). Calls have a 60 s ceiling (`SPACE_TIMEOUT_MS`); one dropped connection is retried once, a timeout or the Space's own error is not. Voice prompts get a 6 s budget: a miss plays the carrier's `<Say>` voice while the clip finishes in the background and is cached for the next caller.
- *English speech stays on the carrier voice* — the Space's English voice is a heavy model with no latency guarantee.
- *Licence.* The Space is labelled CC-BY-NC-4.0, which is fine for the prototype and needs an answer before F2M earns money.

**Rejected:** Keeping `local-models/` as the only route to the owner's models (needs a GPU-less laptop to load PyTorch and still lacks the voices and v3); converting WebM on the server with ffmpeg (a new system dependency on every deploy, when the browser can encode WAV itself); calling the Space's `/agent/chat` or chat brain (out of scope — F2M needs hearing, translation and speech only); making English TTS default to the Space (latency risk mid-call).

## D-046 · 2026-11-14 · Remove the integrations F2M will not use: Khaya, the HF speech rail, local-models, MTN MoMo direct

**Decision:** The language layer is now `mock | space` only (D-045): the Khaya AI providers (ASR, MT, TTS), the Hugging Face speech rail (Whisper ASR and LLM translation, D-041), and the `local-models/` Python service (D-044) are deleted along with their tests, settings (`KHAYA_API_KEY`, `MT_MODEL`, `ASR_MODEL`, `LOCAL_MODELS_URL`) and the `local-models` script. The MTN MoMo API provider is deleted too — the provider, its callback routes, `npm run momo:provision` and every `MOMO_*` setting — leaving the simulated payment rail. `PAYMENT_PROVIDER` stays in code with the single value `mock` because demo-only shortcuts are locked to it. `npm run i18n:draft` now always drafts with the Space. HF grading (`GRADING_PROVIDER=hf`) and Africa's Talking (SMS, voice, USSD) stay: they are in use.

**Why:** The owner asked for every unused integration and empty placeholder to go. The Space already does everything Khaya, the HF speech rail and local-models did, and covers Kusaal, which none of them did fully. MTN direct was already advised against (docs/COSTS.md §6: worse rates and heavier onboarding than a licensed aggregator), and the payment design is being reopened in Phase 3 anyway.

**Kept on purpose:** `momoMsisdn` fields and "MoMo" wording in the product — payouts still go to a farmer's mobile-money number; only the MTN API integration is gone. The `external:momo` ledger account name is unchanged so existing journals keep their meaning. Every removed piece is in git history if it is ever needed again.

## D-047 · 2026-11-14 · Real accounts: one Supabase login per person, invite-only, a simulator switch and a carrier token

**Decision:** Every web user — farmer, buyer, driver — signs in with a phone number and password through Supabase Auth. Supabase holds logins only; F2M's server holds everything else. The server verifies each access token against the project's public keys (JWKS, `jose`), and a new `accounts` table links the Supabase user to the one farmer, buyer or driver row that phone holds. The route guards still hand routes `req.user = { sub: <role row id>, kind }`, so no route changed. Signup is two steps: Supabase account, then `POST /api/account/register` (role, name, region, plus company/district/vehicle). The phone always comes from the verified token, never the form. A phone that registered by USSD is linked, not duplicated, and one role per phone still holds. The old three logins are gone: buyer email/password and the seeded demo buyer, farmer SMS codes (`login_otps`), driver PIN web login (the PIN stays optional for USSD). Until an SMS sender ID is approved, Supabase cannot prove phone ownership, so signup is invite-only, enforced inside Supabase by a Before-User-Created hook (`supabase/migrations/0001_invite_only_signup.sql`). Also: `SIMULATOR_ENABLED` (default on) gates the `/api/dev/*` inboxes, the tester pages, the recording upload and demo-only acceptance; `CARRIER_WEBHOOK_TOKEN` is required on `/ussd` and `/voice/*` once the simulator is off, and boot fails without it. Every callback URL F2M hands the carrier carries it. The anonymous create routes (`POST /api/farmers`, `POST /api/lots`, lookups by phone) are removed, and the full lot trace (with amounts) is only for a buyer trading on that lot.

**Why:** The owner wants to run on real phone numbers — themselves and friends — not demo data. That needs real identity on one system instead of three, and it needs the demo's open doors shut, without losing the simulator, which is the only way to use USSD and voice before paying for a live shortcode and voice number.

**Rejected:** Keeping F2M's own auth (password resets, sessions and rate limits rebuilt by hand, and no path to Supabase's SMS hook later); storing profiles in Supabase (two databases describing one person — the old `profiles` design, whose policy also let a driver mark themselves verified); trusting the phone in the signup form (anyone could claim another person's number); an open signup before SMS works (anyone could register a friend's number first).

**Known limits:** One login per browser — use a second browser or a private window to be two roles at once. The Supabase free plan pauses after a week of low activity. With the simulator on, anyone who can reach the server can act as any phone through the simulator, so it is for a closed test group only.

## D-048 · 2026-11-14 · The Harvest Journal: an editorial redesign, a public front door, and plain words

**Decision:** The web app's visual world changes a third time, at the owner's request, modelled on the design language of a reference site the owner chose (innofemme.org) while keeping F2M's own identity. The owner chose to keep the F2M green brand over the reference's aubergine and coral. What changed:

- *World:* a warm cream ground (`--paper` #efe9df, cards #fbf8f3) instead of white-on-mint; deep-green feature fields (`--forest-night` #0c3d24) for panel headers, the landing's story sections and the footer; `--forest` stays every primary action. Gold is the italic accent and the money colour.
- *Type:* Newsreader (self-hosted, variable, latin + latin-ext) for headlines through a new `.headline` class, with one italic word in gold (`<em>`); Hanken Grotesk stays for everything else. A widely tracked `.eyebrow` label sits above headlines. `.display` keeps its old job for small uppercase marks.
- *Chrome:* the solid green masthead becomes a cream sticky header with a floating pill nav (active tab a filled deep-green pill); the language legend and the "payments are simulated" note move to a slim footer.
- *Front door:* `/` is a public landing page (hero, why, how it works for farmers, buyers and drivers, languages from the live registry, closing call to action). It was a redirect to `/market`. Login is a split screen with the story on the left; `?mode=signup` opens the create-account tab.
- *Detail and feel:* every home screen opens with a greeting by time of day and a one-line summary that leads with what is waiting (offers to answer, a job on the road); empty screens get a picture, one sentence and one next step (`EmptyState`); loading shows shimmering placeholders (`Skeleton`); buttons sink slightly when pressed; actions confirm themselves with a toast (`toast()`); every page names itself in the browser tab; unknown links land on a friendly not-found page; checkboxes and sliders take the brand green; headlines balance their line breaks.
- *Plain words:* farmer- and driver-facing labels drop the trade jargon ("Incoming Bids" → "Offers waiting for you", "escrow hold" → "held for you", "reference priced" → "Market price", "Same-day" → "Ready now", "Dispatch Queue" → "Coming up"), and raw codes such as `UPPER_EAST` no longer reach the screen. New strings go through `t()` (D-050) so they translate.
- *Simulator:* the handset's standby screen and idle keypad are readable (they were olive on olive at 35% opacity); internal decision numbers no longer appear in its copy.

**Why:** The owner asked for the reference's look, then for a product people want to come back to, with close attention to small details. Research on farmer-facing apps points the same way: plain tested words, short predictable flows, feedback on every tap, and a home screen that leads with the unfinished thing.

**Kept:** the cedi stays written "GHS". The owner's typeface has no ₵ glyph, so "GH₵" would draw the cedi sign in a fallback font, and GHS is what MTN MoMo messages already show farmers.

**Rejected:** the reference's aubergine and coral palette (it would make F2M look like a different organisation); copying the reference's assets (its 3D artwork, wording and logo); a third display face for the giant watermark word (Hanken Grotesk at 800 does the job without another download).

**Addendum (same day): phones first, and one page per sale.**

- *Phones:* 360px is the baseline, checked for every role. Below `lg` a bottom tab bar replaces the pill nav (a sideways-scrolling tab row hid sections), pages lead with the task (the farmer's offers, the driver's jobs) and settings go last, tables become cards, dialogs are bottom sheets, and the sign-in library loads only for someone with a saved login (the main script fell from 153 to 99 KB gzipped). Rules in `apps/web/DESIGN.md`, "Phones first".
- *The deal page* (`/deals/:id`): one page per sale for the buyer, the farmer and the driver, built on `GET /api/deals/:id`. It leads with whose turn it is ("Your maize has arrived. Confirm, or report a problem", or "Waiting for Ama"), then where the money is, then every step so far with the texts and calls sent to the farmer, then the steps still ahead. Buyers confirm receipt or report a problem there, farmers answer a claim, drivers mark each milestone. Every link to a sale now opens it.
- *Why:* one sale was spread across six pages, each showing one person's slice. With money held, an advance, a receipt deadline and claims, people need one place that says where their sale stands and what is theirs to do.

## D-049 · 2026-11-14 · The five Ghanaian languages go live, machine-translated by the owner's Space

**Decision:** At the owner's direct request, Twi, Ewe, Dagbani, Hausa and Kusaal are live on every farmer- and driver-facing surface — SMS, USSD menus and voice prompts — through the existing `I18N_DRAFT_LOCALES_LIVE=true` switch (now the value in `.env.example`, `fly.toml` and `render.yaml`). Every catalog was completed by `npm run i18n:draft` with the owner's Tɛkyerɛma language Space: each phrase a catalog lacked was translated by the Space, and the drafts already there (Twi's 148 from Khaya and Gemma, the earlier Ewe and Dagbani subsets) were kept. `npm run i18n:draft -- --all` redrafts everything with the Space if one engine throughout is preferred. The review gate itself is unchanged: `_reviewed` stays empty, nothing in the product claims a native speaker checked these texts, and setting the switch to `false` puts every farmer surface back on English in one step. The code default stays `false` so a bare checkout is English-only; the test suite pins it.

**Why:** The owner wants farmers to meet F2M in their own language now, while the language models keep improving, rather than wait for native review. The language layer is the owner's own work and the owner's call.

**What keeps it safe:** Numbers never pass through translation. Every `{amount}`, `{kg}`, `{price}` and lot code is masked before translating and restored after, and a translation that loses or duplicates one is dropped — that key falls back to English. So a price or a quantity cannot be mistranslated, only the words around it. With `TTS_PROVIDER=space`, voice prompts are spoken in the farmer's language by the Space. A voice never reads English text in a local voice (`speechLocale`).

**Known risk:** The Space's own round trip of a marketplace sentence came back noticeably wrong for Kusaal and Dagbani (D-045 measurements), so some wording will read oddly to native speakers. That is the reason the gate exists and the reason review is still on the roadmap (Phase 5).

**Rejected:** Marking the catalogs `_reviewed` (a false claim of native review).

## D-050 · 2026-11-14 · The web interface translates too, from the same catalogs

**Decision:** Every phrase a person reads on the web portal is written as `t('web.<page>.<name>', 'English text')` (`apps/web/src/lib/i18n.tsx`). The English in the code is the source of truth and the fallback. `npm run i18n:extract` collects those phrases into `en.json` under `web.*` keys, and `npm run i18n:draft` translates them with the Space, next to the SMS, USSD and voice texts. The server serves one language's phrases at `GET /api/i18n/web/<code>` (public, because the login page needs it), each phrase falling back to English on its own. The choice is made with the language picker on the farmer and driver dashboards (which also sets SMS, USSD and calls) or the language row in the header, and the browser remembers it.

**Why:** The owner switched language on a phone and still saw English: only the phone channels were translated. Farmers and drivers on smartphones should read the same language they hear on a call.

**Gate:** The web is gated exactly like `t()` (D-040, D-049). A locale that is not live is served entirely in English, so `I18N_DRAFT_LOCALES_LIVE=false` turns every surface, web included, back to English in one step.

**Left in English on purpose:** names of people and businesses, lot codes, phone numbers, `GHS` amounts and the brand "Farm to Market". Values go in as `{placeholders}` and are never translated.

**Rejected:** a separate web i18n library and catalog (two places to translate the same words); translating in the browser at runtime (slow on a cheap phone, and it would send farmers' screens to a translation service).

## D-051 · 2026-11-14 · Phase 1: every offer is a negotiation; buyer requests are public

**Decision:** An offer is no longer a contract that the engine creates at the buyer's price, which the farmer can only take or leave. It is an **offer thread** (`offers`, with every move in `offer_events`) between one buyer and one farmer about one listing. It holds the current proposal (whole units and a price per unit) and whose turn it is. Whoever has the turn can accept, counter or reject; the side that is waiting can withdraw. A proposal lapses on the crop's offer clock, which restarts with each counter, and the farmer gets one reminder after three hours. A thread can start in three ways: a buyer bids on a listing; a farmer answers a buyer request, which every farmer can see on the web and under USSD "8. Buyer requests"; or the engine turns a request that fits a listing into a bid at the request's price for the listing's declared grade. The design is in `docs/PHASE1.md`.

**Accepting** is one transaction. It checks the listing still has the units, then creates the order as a contract **already in ACCEPTED**, with `agreedTotal = units × price per unit` (exact pesewas). It links that contract to a demand and a match like every contract before, so payment, pickup, grading, transport, settlement and the trace are unchanged. It also takes the units off the listing, and the payment hold starts as before. A listing with units left stays on the market. An open bid does not reserve a listing: the first acceptance wins, and a later one that no longer fits is refused with "Only N … left". A request's kg are held while a farmer's offer on it is open, so the engine never over-buys.

**Money until Phase 3:** an agreed deal pays its agreed total whatever the grade. REJECT still refunds the buyer in full. The per-grade price schedule now only sets the engine's opening bid.

**Listings** gain an optional asking price per unit ("let buyers bid" if empty), harvest date, community and landmark. A farmer can change price and quantity, mark a listing sold elsewhere, or remove it, on the web and by USSD. Listings lapse after `LISTING_TTL_DAYS` (30), with a warning SMS two days before. Changing a listing renews it. Removing, selling or lapsing ends the open threads, and their buyers are told.

**Phones:** USSD has full parity: offers with accept, counter (price typed on the keypad) and reject, the buyer-request list with "offer my produce", listing management, and a price step in the sell flow. The voice call reads the proposal and takes 1 to accept and 2 to reject. Counter-offers by voice are Phase 2.

**Kept for the web's move:** the older contract routes and `contractId` on the engine's preview and simulate endpoints still work. Contracts in OFFERED created before this change can still be accepted or declined.

**Rejected:** reserving a listing for the first bidder (one slow buyer would block every other); counter-offers in kg (farmers trade in bags, crates and bunches); a separate "order" table beside contracts (everything after acceptance already runs on contracts); keeping per-grade refunds for an agreed price (two prices for one deal).

## D-052 · 2026-11-14 · Phase 2: the call asks, reads back, and waits for a 1

**Decision:** A farmer on a basic phone can list, manage listings and negotiate entirely by voice (design: `docs/PHASE2.md`). The call engine (`apps/server/src/ivr/`) now gives every step a way of listening: one key, a number ended by `#`, speech, or "type it or say it" (a `GetDigits` that falls through to a `Record`). Each call keeps a memory between answers (`voice_calls.state`, migration 0014), and a call to the listing line gets a call row too (`direction: inbound`). The keys mean the same everywhere: **9** hears it again (**\*** on a number step), **0** goes back, **#** ends a number. Silence is asked again twice, then the call ends politely.

**Listing by voice:** reached from USSD "Sell → 8" (F2M calls back, free for the farmer) or the listing line's menu. The farmer first says it all in one go, and `parseListingDraft` keeps only what was clearly said (crop, quantity and unit, price per unit, harvest and ready days, quality words). The call then asks only for what is missing. A field not understood after two tries moves to the keypad (the crop list is read four at a time). Quality is two yes/no questions written for each crop. The whole listing is read back, and it is published only on **1**; **2** changes one field, **3** cancels with nothing saved. The recordings and transcripts are kept with the listing (`voice_listings`).

**Negotiating by voice:** the offer call adds **3** counter (price typed, or said as "I can sell the 10 bags but I want 2,100 cedis a bag", then the quantity, then a readback) and **4** hear again. On the listing line, waiting offers are heard one after another and each answer returns to the list.

**Managing by phone:** the line reads each listing and can change its quantity (as "how many are left"), price and ready date, mark it sold elsewhere, or remove it. USSD gains "Ask for transport" on a secured order (the farmer-suggested delivery from D-037) and "Change ready date".

**Never guess:** "bags" of a crop sold in two bag sizes is asked, not assumed; two crops in one sentence names neither; a bare "good" is not a grade ("good morning" listed grade B before this was caught); "2,000" is one number, and "thousand" is a number word.

**Slow voices:** a sentence the Space has never spoken (a readback with the farmer's own numbers) can miss the 6-second wait. The call then says "one moment" and comes straight back (`<Redirect>`), at most twice, before the gateway voice reads it (`TtsProvider.isPending`). Hearing a recording is slow too: live, ASR plus MT took 15 s, longer than a voice gateway waits for an answer. So a recording is heard in the background. The call waits up to 4 s, then holds with "one moment" until the hearing is done (up to six holds; after that the step is asked again).

**Live check (2026-11-14):** a Twi listing sentence spoken by the Space's own Twi voice went through a real server with ASR, MT and TTS all on the Space. The listing was published correctly: 20 × 50kg bags of maize at GHS 500, grade A. ASR heard the Twi well. MT turned it into "I will give them one tenth of an ephah of corn… on the day of the fifth month". The parser kept only "corn" → maize and the call asked for the rest by keypad. This is the "never guess" rule working, and it is also the clearest evidence for fine-tuning the Space's Twi→English translation on farm sentences (Phase 5).

**Calls that go quiet:** an answered call is judged by its last step, not by when it was dialled, so a long listing is never cut off. A farmer who hangs up mid-call is never rung back: the call is closed as `hung_up`.

**Not verified live:** Africa's Talking's `GetDigits` (`numDigits`, `finishOnKey`, `timeout`) and `Record` (posting `recordingUrl`) are confirmed from its SDKs and documentation pages; its `Redirect` and the exact behaviour of a mid-call `Record` callback, or of a `GetDigits` followed by a `Record`, could not be confirmed from the documentation and need a voice number to test (Phase 6). The SMS receipt and the USSD routes stay as the fallback for every step.

**Rejected:** a one-question-at-a-time form for everyone (slow for farmers who can say it all at once); publishing what the parser understood without a readback (vision §5.3: never publish blindly); typing letters on the keypad; separate voice and USSD rules for listings (both call the same `registerLot` / `updateLot` / `counterOffer`).

## D-053 · 2026-11-14 · Live prices: a history of every price, and a fair-price engine

**Decision:** Every price F2M sees is stored in `price_observations` (migration 0015) with how far to trust it: `deal` (an agreed price), `market` (a survey, feed or hand-entered quote), `ask`, `offer`, `request`, `reference` (the seed's placeholders). Listing, bidding, agreeing and requesting record one automatically, so prices keep arriving without anyone entering them. `priceIntel.ts` turns them into a fair-price range (a weighted median, recent evidence favoured, half-life 21 days, nothing over 180 days, outliers trimmed), a 30-day trend, series for charts, a seasonal outlook, and a verdict on any typed price. `market_prices` stays as the latest quote per market for what already reads it. Design and feed format: `docs/PRICES.md`, `docs/INTELLIGENCE.md`.

**What the research found (2026-11-14):** the one verifiable public source, WFP's Ghana series on HDX (from MoFA via FAO), runs 2006 to **July 2023** and then stops; MoFA's weekly prices and FAO FPMA have no API we could confirm. So the official data feeds trends over years and seasonality (maize peaks in July and bottoms in October on the real file), and "latest" comes from F2M's own activity plus any current source plugged into the feed (`POST /api/feeds/prices` with a token, or a polled `PRICE_FEED_URL`).

**Guidance, not a gate:** a price far off the market is flagged in the web forms and, before the farmer presses 1, in the USSD sell step. It never blocks. With only placeholders the engine says "reference", and with nothing recent it says nothing rather than show an old number as today's.

**Rejected:** treating the 2023 WFP prices as today's (the cedi has moved a lot since); letting a model produce prices (arithmetic over the data is explainable and works offline); colouring "rising" red or green (it is good news to a seller and bad to a buyer, so direction is an arrow and words).

## D-054 · 2026-11-14 · Live screens: a stream that says "something changed"

**Decision:** `GET /api/stream` is a server-sent-events stream, authenticated by the normal bearer token. A message names only the topics that changed (`market`, `prices`, `offers`, `notifications`, `demands`, `alerts`); the web then re-reads through the usual authenticated API, so the stream carries no data and cannot leak any. Bursts within 250 ms are one message; each person may hold four streams; a stream ends after 30 minutes so the client reconnects with a fresh token. Events are published where state already changes (lot events, offers, requests, both notification queues, price records) by `publishLive`, which never throws. The web streams with `fetch` (an `EventSource` cannot send the header) and reconnects with backoff; page polling stays as the safety net.

**In-process on purpose:** F2M is one server on one SQLite file. A second server would swap `domain/events.ts` for a shared bus (Redis, Postgres NOTIFY); nothing else changes.

**Rejected:** WebSockets (the traffic is one-way and SSE passes proxies and reconnects by itself); sending data in events (a leak risk and a second source of truth); token in the URL (it would be logged).

## D-055 · 2026-11-14 · Alerts that reach the right people, once, and "who has what"

**Decision:** When something new appears, the people it matters to are told by rules, each saying why. A new listing reaches buyers who watch that crop, have an open request for it, or bought it before, nearest first (a buyer the engine already bid for is not told twice, and a price well under or over the market is said so). A new request reaches farmers who listed that crop in the last year and have nothing listed now, within the crop's reach, by SMS in their language. A price line a person set (`price_watches`) or a 10% move in two weeks alerts the people it touches. Every alert is logged (`alert_log`, migration 0017) so the same news is never sent twice; one listing or request reaches at most `ALERT_MAX_RECIPIENTS` (8); a farmer gets at most `ALERT_SMS_PER_FARMER_PER_DAY` (2) alert texts; a crossed price line rests a week. An alert failure never undoes the listing or request that caused it. `supplyDemandByRegion` gives kilograms listed and wanted per region with no names.

**Not AI:** matching and alerting stay rules over the data, so each can be explained, tested and capped. A farmer is not a notification feed.

**Rejected:** alerting every watcher of everything (it would train people to ignore us); a model choosing recipients; naming sellers in the supply view (they chose to publish a listing, not their location).

## D-056 · 2026-11-14 · The language-model assist: off by default, a suggestion engine

**Decision:** An optional layer (`providers/llm`, `aiAssist.ts`) calls Anthropic's Messages API with a structured-output schema. **It is off** (`LLM_PROVIDER=off`) until the owner sets `LLM_PROVIDER=anthropic` and a key. Off means nothing leaves the server and every feature behaves as before. When on, only short text being understood goes out, with phone numbers and e-mail addresses removed; names and ids are never sent. It is used to: fill gaps in the one-breath voice listing, read a buyer's plain-words request into the form, check a listing photo shows the crop, and group failed voice listings (`npm run ai:triage`).

**Guards:** the model's answer is checked against the platform's registries and against the person's own words. A number must be one they said (a weight said as "fifty kilos" cannot become a price); a unit must be singled out by their own words, so "bags" of a crop sold in two sizes is still asked (D-052); a crop is never named for a farmer and quality is never taken from it. It fills only fields the rules left empty, everything is read back, and a listing is published only on the farmer's 1. Fields it supplied are saved as `aiFilled`. Any failure returns nothing and the feature carries on.

**Not model-driven:** price guidance, offer advice (`/api/offers/:id/advice`), matching and alerts are arithmetic and work with the assist off.

**Open for the owner:** sending farmers' sentences to a hosted model is a privacy decision against D-047; it needs the owner's explicit yes. The choice of model is theirs too (`claude-haiku-5-5` is the likely fit for live calls). The request has been tested against the documented API shape with a stand-in `fetch`, not the live service (no key was available), and it uses `fetch` rather than the SDK because npm could not resolve the shared workspace tree at the time.

**Rejected:** letting the model name the crop or grade for a farmer (a wrong listing is worse than asking); publishing what it proposed without the readback (D-052); a model deciding prices or recipients.

## D-057 · 2026-11-14 · Phase 3: paid in two parts, received or claimed, every claim reviewed

(D-053 to D-056 are reserved for the price-intelligence work in a parallel session.)

**Decision:** The owner set the settlement rules, and they are now what the code does (design: `docs/PHASE3.md`):

- **The farmer is paid in two parts.** An advance of `FARMER_ADVANCE_PERCENT` (default **30%**; the owner did not fix the share) of the order total goes out when the produce is graded at pickup, for any grade but REJECT. The balance goes out when the buyer confirms receipt.
- **The driver is paid on delivery.** The fee goes out when the order is received.
- **A delivery confirms itself after 24 hours** (`RECEIPT_WINDOW_HOURS`), so a silent buyer never leaves a farmer waiting.
- **Claims: the owner chose both options.** The buyer reports a problem (short weight, quality, damaged, late, not delivered, other) and proposes a deduction. The farmer accepts or refuses by SMS and call, USSD or the web. Accepted, the order settles with the deduction. Refused, or unanswered within `CLAIM_ANSWER_HOURS` (24), the undisputed part is paid at once and F2M decides the rest, from nothing up to the buyer's proposal. **F2M reviews every claim**, accepted ones as an audit.

The order gains three states: `DELIVERED` (the receipt clock runs), `CLAIMED` and `RECEIVED` (the balance is on its way). The delivery job gains `ARRIVED`, and the driver milestones are on USSD and the API: at pickup, loaded, set off, arrived. Payouts carry a `kind` (advance or balance). Claims live in `order_claims` (migration 0016).

**Rules that keep the books true:**

- A deduction can never exceed what is still held. The advance is on the farmer's phone and is never pulled back, so a bigger loss is a review matter, not an automatic clawback.
- A disputed re-grade that comes back REJECT after the advance went out refunds the buyer only what is still held.
- Claims about the transport itself (not delivered, damaged) also hold the driver's fee until F2M decides.
- Each payout is posted to the ledger as it lands, and the refund at `SETTLED`. Every journal balances and the escrow ends at 0.
- An order with no transport job waits out the farmer's grade-dispute window before its receipt clock starts, so delivering never cuts the dispute short.

**Until Phase 4:** there is no admin role yet, so F2M's decision on a claim is made through a simulator-only route (`POST /api/dev/claims/:id/resolve`), and the review queue is `GET /api/dev/claims`. All money is still simulated until a licensed provider is chosen (Phase 6).

**Rejected:** paying the farmer in full at pickup (the buyer pays before seeing the produce; this was the code until now); holding all the farmer's money until receipt (the owner wanted cash in farmers' hands early); clawing back an advance on a claim (mobile money cannot be pulled back, and it would turn a dispute into a debt); freezing the whole payment on any claim (only the amount in question is held).
