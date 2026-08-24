# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Sellers (farmers), two confirmed segments:**
- **Smartphone / literate farmers** — fill the web Seller Dashboard themselves: list lots with quantities, ask prices, and produce photos; accept or decline bids; watch payouts.
- **Non-smartphone / non-literate farmers** — never see the web. They list by USSD menus or by one open-ended IVR call (speak what they have; the ASR→MT→parse pipeline creates the listing). They receive offers as voice calls, accept by keypress, and are reached by buyers **by phone call**, not text.

**Buyers — a genuine mix of three personas, none of which wins layout decisions alone** (confirmed by owner):
- Market aggregators and traders on mid-range Android phones, often outdoors at markets, in short sessions;
- SMB processors, restaurants, and caterers planning weekly orders on mixed devices;
- Institutional procurement desks (exporters, NGOs) on laptops needing records and traceability.
The buyer portal must therefore hold up on a phone in daylight AND on a desktop for record-keeping — responsive parity is a product requirement, not a nicety.

**Drivers** — local drivers onboarding themselves as a side hustle: register by USSD, run a web dispatch board, get hired directly by buyers or dispatched nearest-first, paid from escrow on verified delivery.

## Product Purpose

A national Ghanaian agritech marketplace connecting smallholder farmers to verified buyers around a six-step, commodity-agnostic transaction spine: **register → match → contract → grade → pay → trace.** Escrowed mobile-money payments, AI photo grading that explains itself, escrowed logistics, and a public append-only trace per lot.

**Success (next few months, confirmed):** the first handful of REAL settled farmer-to-buyer transactions through escrow, end to end, in the field. Liquidity and funding follow proof, not the reverse.

## Positioning

The claim a neighboring marketplace cannot truthfully copy: **a farmer with a basic phone is a first-class counterparty to the same transaction a desk buyer sees.** Feature parity (USSD = IVR = web over one domain layer) is a hard rule, not a fallback. Supporting mechanisms: consent-first escrow (money moves only on the owning party's explicit yes), AI grading that shows its reasons and can be disputed, one double-entry ledger carrying produce and transport money, and a public QR-scannable chain of custody with no login and no leaked personal or money details.

## Operating Context

- Ghana; money rides MTN MoMo rails (integer pesewas end to end). USSD/SMS/voice ride Africa's Talking wire formats.
- The live deployment serves **both a small real pilot and stakeholder/investor demos at once** (confirmed): flows must be honest enough for real users and presentable enough to drive live in a pitch. The three-tab demo story (USSD simulator + IVR simulator + portal) is part of how the product is evaluated.
- Buyer scenes range from sunlit market stalls on Android phones to office laptops (see Users).
- All external providers are mock-first and env-selected; the offline demo (`npm run demo`) must always exit green. Real keys (HuggingFace grading, MoMo sandbox, Africa's Talking, Khaya AI) are pending on the owner's accounts — each is a documented env flip, never a code change.

## Capabilities and Constraints

- The full spine is live for 8 commodities with per-grade frozen price schedules, escrow hold/release, explainable grading with a dispute window, and settlement with buyer refunds of the grade delta.
- Listings carry their **channel** (`web`/`ussd`/`ivr`): web listings show seller photos; USSD/IVR listings show the farmer's phone and a call-to-negotiate affordance instead (those farmers may not read SMS).
- Logistics: rate-card quotes, sequential nearest-first dispatch, buyer direct-hire of a chosen driver, farmer-suggested delivery that the buyer approves and funds.
- Voice listing pipeline: open IVR call → ASR → MT → registry-driven parser → live lot. Khaya AI (GhanaNLP) providers are implemented and gated on `KHAYA_API_KEY`.
- **Terminology:** lot, demand, match, offer, contract, band/grade (A/B/C/REJECT), hold, payout, spine, channel, pool bid.
- **i18n rule:** every farmer-facing string lives behind catalog keys; Twi/Ewe/Dagbani exist only as machine-drafted, review-flagged subsets and must never be farmer-facing until native-speaker review. English is the working language until "language day."
- Undecided (do not invent): real-provider go-live timing; final language rollout scope; pricing/fees for the platform itself (no platform fee exists today — never render one as if it did).

## Brand Commitments

- Name: **Farm to Market**; mark: the **F2M** seal. Sub-line in use: "Agritech Marketplace · Ghana".
- The visual world is **The Trade Instrument** (D-039, owner-approved 2026-08-24, superseding the Figma system of D-030 at the owner's explicit request): cedi banknote / security-print grammar — intaglio green `#14322B` ink on tinted banknote paper `#EFEBDD`, bronze-gold `#A87B23` value figures, oxide-red `#9E3B2C` stamps, engraved guilloché at frames, Cinzel engraved capitals, Public Sans document text, Courier Prime serials and money. DESIGN.md (written from the built world) is the visual authority; the Nokia-LCD simulator pages are unaffected props.
- Voice: plain, honest, consent-literate microcopy. The product never overstates — no fabricated blockchain language (the append-only trace is described as exactly that), machine translation is visibly flagged, demo-only actions are labeled as demo.

## Evidence on Hand

- A fully working offline demo: `npm run demo` drives register→…→trace across USSD, IVR, and REST wires and exits 0 on balanced books; 127 automated tests.
- Seeded demo data only. **There are no real customers, transactions, testimonials, or press yet — never fabricate any.** The first real settled transaction is the milestone being pursued.
- The living docs trail (`docs/PROJECT.md`, `docs/DECISIONS.md` D-001…D-038, `docs/BUILDLOG.md`) is the authoritative record of what exists and why.

## Product Principles

1. **Consent is the spine.** Nobody moves another party's money or goods without their explicit yes — farmers accept offers, buyers approve fees, and demo shortcuts are hard-gated to mock mode.
2. **The basic phone is a first-class seat.** Any capability added to the web must have a story for the USSD/IVR farmer, even if that story is "the buyer calls them."
3. **Honesty over theater.** Real data or clearly-labeled demo data; flagged machine translation; grades that explain themselves; an append-only record instead of blockchain cosplay.
4. **Provable offline.** Every provider mocks; the demo gates every milestone; a claim that can't run without API keys isn't done.
5. **Money stays boring.** Integer pesewas, balanced journals, escrow zero at terminal states — the excitement belongs to the produce, never the ledger.

## Accessibility & Inclusion

- Non-literate users are served by voice (IVR flows, open voice listing) and by phone-call affordances; text is never the only path to a farmer.
- Local languages (Twi, Ewe, Dagbani, Hausa planned) arrive via Khaya AI ASR/MT/TTS, strictly gated on native-speaker review of catalogs.
- Sunlight legibility and mid-range Android performance are real buyer conditions; functional text keeps an 11px floor (design detector enforced).
