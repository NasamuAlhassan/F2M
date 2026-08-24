---
name: Farm to Market — The Trade Instrument
description: Security-printed trade-instrument UI — every lot a certificate, every payment a banknote-grade receipt.
colors:
  paper: "#efebdd"
  paper-deep: "#e7e1cd"
  paper-lift: "#f4f1e6"
  ink: "#14322b"
  ink-8: "#2b463d"
  ink-7: "#425a4f"
  ink-6: "#596d61"
  ink-5: "#718074"
  ink-4: "#8d998a"
  ink-3: "#aab2a0"
  ink-2: "#c8cbb6"
  ink-1: "#dcd9c4"
  gold: "#a87b23"
  gold-deep: "#8a6318"
  gold-ink: "#6e4e12"
  gold-wash: "#e9ddbe"
  stamp: "#9e3b2c"
  stamp-deep: "#7e2e22"
  stamp-wash: "#ecdcd0"
typography:
  display:
    fontFamily: "Cinzel, Times New Roman, serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.1em"
  body:
    fontFamily: "Public Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  serial:
    fontFamily: "Courier Prime, Courier New, monospace"
    fontSize: "14px"
    fontWeight: 400
  label:
    fontFamily: "Public Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.14em"
rounded:
  hairline: "1px"
  frame: "2px"
  stamp: "3px"
  seal: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.frame}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.ink-8}"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.frame}"
    padding: "8px 16px"
  input:
    backgroundColor: "{colors.paper-lift}"
    textColor: "{colors.ink}"
    rounded: "{rounded.frame}"
    padding: "8px 12px"
  card-certificate:
    backgroundColor: "{colors.paper-lift}"
    rounded: "{rounded.frame}"
    padding: "16px"
  stamp-live:
    backgroundColor: "{colors.gold-wash}"
    textColor: "{colors.gold-ink}"
    rounded: "{rounded.stamp}"
    padding: "2px 6px"
---

# Design System: Farm to Market — The Trade Instrument

## Overview

**Creative North Star: "The Trade Instrument"**

Farm to Market's buyer, farmer, and driver portals are drawn as a security-printed trade instrument (D-039, seed 222cf785): every lot is a certificate, every payment a banknote-grade receipt, every state a stamped seal on ruled paper. The world borrows the cedi banknote's grammar — tinted paper under intaglio-green ink, bronze-gold value figures, oxide-red stamps, engraved guilloché and rosettes as line-work at frames — and applies it to a working marketplace where a trader reads lots the way a teller reads notes. It explicitly refuses two defaults: the white-card agri-SaaS dashboard and its dark-terminal opposite.

Density is document-dense: ledger tables with hairline rows, tracked capital column heads over double rules, typed serials and money in a monospace receipt voice. Ornament is confined to frames and seals; inside the frame, content works without decoration in the way. The same page must survive a sunlit market stall on a mid-range Android phone and an institutional desk on a laptop, so legibility floors (11px functional text, `--ink-6` as the lightest functional ink) are part of the system, not an accessibility afterthought.

**Key Characteristics:**
- Tinted banknote paper (`#efebdd`) under intaglio-green ink (`#14322b`); no white, no black, no gray.
- A fixed 9-step ink-on-paper ramp is the only neutral scale.
- Bronze-gold for value and live states; oxide-red for stamps, refusals, and disputes.
- Engraving (guilloché, rosettes, hatching, line-art vignettes) lives at frames and seals only.
- Three type voices: engraved capitals, document text, typed serials — money is always typed.
- Square-cornered, double-ruled print furniture; depth is printed, never cast.

## Colors

An intaglio palette: one green ink diluting into tinted paper, with gold reserved for value and red reserved for stamps.

### Primary
- **Intaglio Green** (`--ink` #14322b): the ink. All primary text, solid "plate" fields (masthead, modal headers), filled buttons, settled-state stamps, done route legs. Selection color inverts it (`::selection` is ink on paper).

### Secondary
- **Bronze-Gold** (`--gold` #a87b23): the value figure and the live signal — rosette strokes, focus outlines (2px), input carets, active nav underlines, the ember dot on live states, active route stations.
- **Bronze-Gold Deep** (`--gold-deep` #8a6318): large money figures (the GH₵ line on certificates), grade-B seals, gold links at rest.
- **Gold Ink** (`--gold-ink` #6e4e12): small gold type on washes — the contrast-safe voice for gold text at or below body size.
- **Gold Wash** (`--gold-wash` #e9ddbe): the tint behind live-state stamps and selected ledger rows.

### Tertiary
- **Oxide Red** (`--stamp` #9e3b2c): the rubber stamp — refusals, disputes, cancellations, grade-C seals, the call-to-negotiate affordance.
- **Oxide Red Deep** (`--stamp-deep` #7e2e22): red stamp text on its wash.
- **Stamp Wash** (`--stamp-wash` #ecdcd0): the tint behind red stamps.

### Neutral
- **Banknote Paper** (`--paper` #efebdd): the page ground and certificate ground.
- **Paper Deep** (`--paper-deep` #e7e1cd): tint zones, alternating ledger rows, ghost-button hover.
- **Paper Lift** (`--paper-lift` #f4f1e6): raised panels — inputs, card interiors, media wells.
- **The ink ramp** (`--ink-8` #2b463d → `--ink-1` #dcd9c4): the only neutral scale. `--ink-8` button hover; `--ink-7` frame rules and secondary serials; `--ink-6` captions, labels, placeholders (the lightest functional ink); `--ink-5` ghost borders; `--ink-4` disabled/dormant marks; `--ink-3` input borders, scrollbar thumbs, dark-plate secondary text; `--ink-2` hairline row rules and inner frames; `--ink-1` faintest ruling.

### Named Rules
**The One Ramp Rule.** The nine-step ink ramp and the three paper tints are the only neutrals. No gray hex ever enters the file; every "gray" is green ink diluting into paper.

**The Gold-Ink Rule.** Gold text at small sizes on tinted washes is set in `--gold-ink` (#6e4e12), never `--gold`. Raw `--gold` (#a87b23) is reserved for strokes, seals, carets, focus rings, large figures, and accents on the dark plate.

**The Four Stamps Rule.** Every lifecycle state renders as a stamped ticket in exactly one of four tone families: settled money is intaglio ink on paper, live states burn gold-ink on gold-wash (with an ember dot), refusals and disputes are oxide red on stamp-wash, dormant states fade to `--ink-6` on paper. No fifth family.

## Typography

**Display Font:** Cinzel 600/700 (with Times New Roman, serif)
**Body Font:** Public Sans 400/500/600/700 (with Segoe UI, system-ui)
**Label/Mono Font:** Courier Prime 400/700 (with Courier New)

**Character:** An engraved certificate speaking three voices — carved capitals for identity, a plain civic document face for prose, and a typewriter for everything the teller would verify. All three faces are self-hosted woff2 in `public/fonts` (no network fonts); the body sets `font-variant-numeric: tabular-nums` globally.

### Hierarchy
- **Display** (`.display`, Cinzel 600, 18–20px, tracking 0.05–0.12em, often uppercase): mastheads ("FARM TO MARKET"), plate headers, page titles, seal initials, grade letters. Identity only — never body copy.
- **Subject** (Public Sans 700, 16px): the commodity name on a certificate card.
- **Body** (Public Sans 400/600, 14px): document text, table cells, form controls. Secondary prose drops to 12px in `--ink-6`.
- **Serial** (`.serial`, Courier Prime, 11–24px): lot serials ("LOT № …"), money, timestamps, phone numbers, counts. Large money is serial bold 24px in `--gold-deep`; stat figures serial bold 18px.
- **Label** (`.smallcaps`, Public Sans 600, 11px, tracking 0.14em, uppercase): ledger column heads, field labels, nav items, captions, document furniture — usually in `--ink-6` (or `--ink-3` on the dark plate).

### Named Rules
**The Three Voices Rule.** Cinzel speaks identity, Public Sans speaks the document, Courier Prime speaks serials, money, and timestamps. Money and serials never appear in the document face.

**The 11px Floor Rule.** Functional text never drops below 11px (`.smallcaps` is the floor), and `--ink-6` (#596d61) is the lightest ink permitted on functional small text and placeholders. Sunlight legibility on a market-stall phone is the reason; the floor is detector-enforced.

## Layout

A centered document sheet: content is capped at **1400px** (`max-w-[1400px]`), main content padded 24px (`px-6 py-6`). The masthead is a solid ink plate in three printed bands — identity row (min 72px: F2M seal, Cinzel wordmark, search, verified-identity chip), a 10px gold guilloché band, then a nav strip separated by an `--ink-8` rule with gold-underlined active tabs.

The marketplace composes as a **filter ledger + certificate grid**: a fixed 208px (`w-52`) left aside of ruled filter groups (each headed by a smallcaps label over a double rule), and a responsive card grid — 1 column on phones, 2 at `md` (768px), 3 at `xl` (1280px), 16px gaps. Detail pages stack `Card` sections vertically.

Responsive behavior is parity, not degradation (a product requirement): on phones the certificates lead — the filter ledger folds behind a "Filters" summary toggle showing an active count, and the masthead search drops to a full-width last row. Wide content (route spines, tables) scrolls inside its own container (`overflow-x-auto`, min-width 600px for the spine).

Spacing rhythm is the Tailwind 4px scale used at **4 / 8 / 12 / 16 / 24**: card padding 12–16px, table cells 12×10px (`px-3 py-2.5`), section gaps 16px, gutter 24px. Density is ledger-like throughout; whitespace is ruled, not empty.

## Elevation & Depth

**No drop shadows.** Nothing floats above the paper; depth is printed. Layers are conveyed by paper tints (`--paper` → `--paper-deep` → `--paper-lift`), hairline rules, inset double frames, and fields of solid ink (`.plate`). The only `box-shadow` usage is flat inset line-work: the ledger's second rule (`0 2px 0 -1px var(--ink-2)` under a 1px border), the stamp's inner border (`inset 0 0 0 0.5px currentColor`), the grade seal's and avatar's concentric inset rings, and `.plate-inset`'s hairline. Modal scrims are ink at 70% opacity — dimmed paper, not glass.

### Named Rules
**The Printed Depth Rule.** Depth is drawn with lines, tints, and plates — never cast with blur. `box-shadow` may only appear with zero blur as an inset ring or a printed second rule.

## Shapes

Square security-print geometry. Rectangles carry a 2px radius at most (certificate frames, buttons, inputs); the inner hairline is 1px; rubber stamps get 3px. Full circles are reserved for seals — grade badges, rosettes, route stations, avatar rings, ember dots. Corners never round beyond that: softness would break the engraved register.

The signature silhouette is the **doubled line**: certificate = 1px `--ink-7` outer rule + 1px `--ink-2` hairline inset 3px; column heads sit on a double ledger rule; stamps carry a 1.5px border plus a 0.5px inset echo; seals and avatars wear concentric rings. Engraved texture appears only as frame furniture: the gold guilloché band (tiled interlaced sines), its ink variant, and the 45° hatch ground for photo-less media wells.

### Named Rules
**The Doubled Line Rule.** Importance is marked by doubling a hairline, never by merely thickening it. Frames, rules, stamps, and seals all carry their second line.

## Components

Component APIs are frozen in `src/components/ui.tsx` (the skin); pages own layout only. Icons live in `src/components/engrave.tsx`.

### Buttons
- **Shape:** near-square (2px radius), semibold 14px, tracking 0.02em.
- **Primary** (`btnCls`): solid ink on paper text, 16×8px padding; hover deepens to `--ink-8`; disabled 40% opacity + not-allowed cursor.
- **Ghost** (`btnGhostCls`): 1px `--ink-5` border, ink text; hover tints `--paper-deep`.
- **Call-to-negotiate** (channel lots): oxide-red bordered, red text, phone glyph + typed number; hover tints `--stamp-wash`.
- **Focus:** global `:focus-visible` — 2px `--gold` outline, 1px offset.

### Cards / Containers
- **The Certificate** (`.certificate`, `Card`): outer 1px `--ink-7` rule + inset 1px `--ink-2` hairline, `--paper-lift` interior, 12–16px padding. `Card` titles are smallcaps `--ink-6` over a double ledger rule with optional right-aligned actions. Market lot cards compose: serial + grade-seal head, engraved-framed media well (photo, or hatch ground with a crop vignette), subject line, ruled value line (serial-bold gold money + smallcaps unit), then Trace (ghost) and **Place Bid** (primary).
- **The Plate** (`.plate`): solid ink field with paper text — masthead, modal and payout headers; smallcaps on plates lighten to `--ink-3`.

### Inputs / Fields
- **Style** (`inputCls`): 1px `--ink-3` border on `--paper-lift`, 2px radius, 12×8px padding, 14px ink text; placeholders `--ink-6`; caret gold.
- **Focus:** border shifts to `--ink-6` (outline suppressed); on the dark plate the search input focuses to a `--gold` border instead.
- **Field:** every input is labeled by a smallcaps `--ink-6` caption above it.
- **Error:** message set as a red `.stamp` ticket, not bare red text.

### State Stamps (`StateBadge`, `.stamp`)
- **Style:** Courier Prime bold uppercase 11px, tracking 0.08em, 1.5px doubled border in currentColor, 3px radius, wash background per the Four Stamps Rule.
- **Live states** carry a 6px `ember`-pulsing dot in currentColor.

### Grade Seals (`GradeBadge`)
- 24px circle, Cinzel bold 11px letter, 1.5px ring plus concentric inset rings. A = ink, B = `--gold-deep`, C = `--stamp`, REJECT inverts to paper "R" on solid ink.

### Ledger Tables (`tableCls` family)
- Smallcaps `--ink-6` column heads over the double rule (`thCls`); 12×10px cells ruled by 1px `--ink-2` bottom hairlines (`tdCls`); numerics in `.serial` (`numCls`). Selectable rows: on = `--gold-wash` + semibold ink (`rowOnCls`); off = `--ink-6`, hover `--paper-deep` (`rowOffCls`).

### Navigation
- Smallcaps tabs on the ink plate: rest `--ink-3`, hover paper, active paper over a 2px gold underline. The live-lot count sits right with an ember gold dot.

### Meters & Stats
- **Bar:** smallcaps label, 7px hairline-bordered track with 1.5px paper inset, solid ink fill, typed two-decimal value.
- **Stat:** serial-bold figure (18px; gold-deep when accented) over a smallcaps caption.

### The Engraving Plate (signature icon system, `engrave.tsx`)
All iconography is drawn from one plate: 24-unit viewBox, `stroke="currentColor"`, strokeWidth 1.4 (detail strokes 0.8–1.1), round caps and joins, `fill="none"`, `aria-hidden`. **CropMark** (8 crop vignettes), **VehicleMark** (tricycle/van/light truck), **Glyph** (document glyphs: search, bell, phone, camera, scale, farmer, driver, check, cross, route, sms, speak), **Rosette** (16-petal double-ring engraved seal), **F2MSeal** (rosette + Cinzel "F2M"; gold-on-paper or paper-on-plate). **The One Plate Rule.** No emoji, no icon fonts, no filled glyph sets — a new icon is drawn on the same plate at the same stroke.

### The Route Spine (`RouteSpine`)
The six-station transaction spine (Register → Match → Contract → Grade → Pay → Trace) as an engraved transit line: done legs solid ink (2px, `route-ink` draw-on), pending legs dotted `--ink-2`, done stations solid ink discs with paper checks, the active station a gold `ember` ring, labels tracked 10px caps colored by state (`--ink` / `--gold-ink` / `--ink-6`).

### Motion
Exactly three authored families, all in `index.css`, all disabled under `prefers-reduced-motion`:
- **seal-land** (0.5s `cubic-bezier(0.16,1,0.3,1)`): a seal stamps down (scale 1.45 → overshoot 0.94 → 1 with rotation settle) — payout advice, landed confirmations.
- **route-ink** (0.9s, same ease): route legs draw themselves in via dash-offset.
- **ember** (1.8s ease-in-out infinite, opacity 1 → 0.35): the damped gold pulse on live states.
Everything else is micro `transition-colors` on hover/active. **The Three Motions Rule.** No fourth animation family; anything that moves is a seal landing, ink drawing, or an ember burning.

### Browser Surfaces
The world extends to browser chrome: ink-on-paper `::selection`, gold caret and gold 2px `:focus-visible` outline, scrollbars as `--ink-3` thumbs bordered by `--paper-deep` track.

## Do's and Don'ts

### Do:
- **Do** frame every content panel as a certificate: 1px `--ink-7` outer rule, 1px `--ink-2` hairline inset 3px, 2px corners, `--paper-lift` interior.
- **Do** set every serial, money figure, timestamp, and phone number in Courier Prime (`.serial`); large money is serial bold in `--gold-deep` with a smallcaps unit beside it.
- **Do** keep guilloché, rosettes, and hatching at frames, seals, and empty media wells only — never as content-area texture.
- **Do** stamp every lifecycle state with `StateBadge` in one of the four tone families; live states get the ember dot.
- **Do** render seller and place identity through the `sellerName()` / `placeName()` guards in `src/api.ts`, so a raw parser string renders as "Verified farmer" — never as a person.
- **Do** keep all three faces self-hosted from `public/fonts` with real fallback stacks.

### Don't:
- **Don't** introduce a gray, a white, or a black — every neutral is an ink-ramp step or a paper tint.
- **Don't** cast drop shadows or blurs; depth is printed (see The Printed Depth Rule).
- **Don't** round rectangle corners beyond 3px; circles belong to seals alone.
- **Don't** set functional text below 11px or lighter than `--ink-6`; small gold type on washes uses `--gold-ink`.
- **Don't** use emoji, icon fonts, or filled glyphs — new icons are engraved on the one plate at stroke 1.4.
- **Don't** add a fourth motion family or any animation that ignores `prefers-reduced-motion`.
