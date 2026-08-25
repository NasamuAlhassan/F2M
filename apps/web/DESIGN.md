---
name: Farm to Market — The Market World
description: A confident agritech marketplace — deep brand green, white cards on a soft green ground, true-to-produce color per crop.
colors:
  paper: "#f5f8f3"
  paper-deep: "#eaf0e6"
  paper-lift: "#ffffff"
  ink: "#16241e"
  ink-8: "#2a3d34"
  ink-7: "#3e544a"
  ink-6: "#58705f"
  ink-5: "#748b7a"
  ink-4: "#93a696"
  ink-3: "#b3c2b3"
  ink-2: "#d2ddcf"
  ink-1: "#e6ede3"
  forest: "#158a4a"
  forest-deep: "#0f6d3a"
  forest-wash: "#e2f5e8"
  gold: "#d97a1f"
  gold-deep: "#b3620f"
  gold-ink: "#8a4c0c"
  gold-wash: "#fbe9d3"
  stamp: "#c0392b"
  stamp-deep: "#962c21"
  stamp-wash: "#f8dcd7"
  info: "#1d5fd9"
  info-wash: "#dbe7fb"
  transit: "#6d3fc4"
  transit-wash: "#e7ddf7"
  success: "#1f8a4c"
  success-wash: "#dcf0e2"
typography:
  display:
    fontFamily: "Hanken Grotesk, Segoe UI, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Hanken Grotesk, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  serial:
    fontFamily: "Hanken Grotesk, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  label:
    fontFamily: "Hanken Grotesk, Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.08em"
rounded:
  control: "8px"
  card: "20px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.paper-lift}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.forest-deep}"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "8px 16px"
  input:
    backgroundColor: "{colors.paper-lift}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  card:
    backgroundColor: "{colors.paper-lift}"
    rounded: "{rounded.card}"
    padding: "16px"
  stamp-live:
    backgroundColor: "{colors.gold-wash}"
    textColor: "{colors.gold-ink}"
    rounded: "{rounded.pill}"
    padding: "2px 6px"
---

# Design System: Farm to Market — The Market World

## Overview

**Creative North Star: "The Market World"**

Farm to Market's buyer, farmer, and driver portals read as a confident, modern agritech product: white cards lifted off a soft green-tinted ground, a bold brand green carrying identity and every primary action, and true-to-produce color on every commodity — a market stall of maize, tomato, and pepper isn't monochrome, and neither is a lot grid. This retired **The Trade Instrument** (D-039's cedi-banknote security-print world: tinted paper, engraved line-art, square corners, no drop shadows), which the owner judged too austere and "basic"-reading against the product's actual energy — a live marketplace, not a printed certificate.

The world keeps what worked from the instrument metaphor — line-drawn crop and vehicle iconography, the F2M rosette seal, stamped state pills, a six-station transaction spine — and drops the printed-depth discipline for real elevation: soft cast shadows, generous rounding, and a saturated palette that commits at page scale (the masthead is a solid green plate, not a neutral bar with a green accent). Legibility floors carry over unchanged: 11px minimum for functional text, sunlight-legible on a market-stall Android phone.

**Key Characteristics:**
- Deep brand green (`--forest` #158a4a) as a bold, page-scale color — masthead, every primary button, "live"/positive states — not diluted into a neutral ramp.
- White cards (`--paper-lift`) on a soft green-tinted ground (`--paper` #f5f8f3), lifted with real soft shadows, not printed frames.
- **True-to-produce color per commodity**: each crop gets its own accent wash + ink (maize gold, tomato red-orange, yam terracotta, pepper red, onion plum, plantain yellow-green, …) — see Crop Accents below. Applied to hero media wells and category icon chips; left neutral in dense ledger rows so tables stay scannable.
- Bronze-gold (`--gold`) for money, live-state pulses, and small brand flourishes; a five-color state vocabulary (gold/info/transit/success/stamp) for lifecycle badges.
- Generous rounding: `rounded-full` pill buttons and segmented controls, 20px cards. No square security-print corners.
- One typeface, one family: Hanken Grotesk (variable, 400–800), self-hosted. Hierarchy comes from weight and size, not a font switch — display and money are both Hanken Grotesk, at 800 and 600 respectively, with tabular figures throughout.

## Colors

A green brand identity on white, with true produce color doing the work a printed-paper texture used to do.

### Primary
- **Forest** (`--forest` #158a4a): the brand. Masthead plate, every primary button (`btnCls`), segmented-control active states, "done"/positive indicators (transaction-spine steps, on-duty toggles, "good load"). Distinct from `--ink`: this is a deliberate saturated brand color, not a neutral.
- **Forest Deep** (`--forest-deep` #0f6d3a): hover/pressed state for every forest-filled control.
- **Forest Wash** (`--forest-wash` #e2f5e8): fallback media-well tint for a commodity with no dedicated crop accent (see below).

### Secondary
- **Gold** (`--gold` #d97a1f): money figures, live-state ember pulses, focus caret, small brand flourishes (the 3px accent bar under login seals and plate headers).
- **Gold Deep** (`--gold-deep` #b3620f): large money figures, grade-B seals.
- **Gold Ink** (`--gold-ink` #8a4c0c): small gold text on washes.
- **Gold Wash** (`--gold-wash` #fbe9d3): tint behind live-state stamps and selected filter rows.

### State vocabulary (five tones, `StateBadge`)
Contracts and delivery jobs move through more states than a simple "settled vs. refused" binary, so state pills get five distinct tones instead of the four-stamp system the paper world used: **gold** (live/pending, ember dot), **info** (`--info` #1d5fd9, assigned/in-progress), **transit** (`--transit` #6d3fc4, en route/picked up), **success** (`--success` #1f8a4c, settled/delivered/paid — distinct from brand `--forest` so "the money landed" reads unambiguously), **stamp/alert** (`--stamp` #c0392b, disputed/declined/cancelled). Faded/expired states drop to `--ink-6` on paper.

### Neutral
- **Paper** (`--paper` #f5f8f3): page ground — a soft green-white, not tinted banknote paper.
- **Paper Deep** (`--paper-deep` #eaf0e6): tint zones, alternating rows, ghost-button hover.
- **Paper Lift** (`--paper-lift` #ffffff): cards, inputs — true white, literally raised off the green-tinted ground.
- **The ink ramp** (`--ink-8` #2a3d34 → `--ink-1` #e6ede3): body text and structural neutrals, recalibrated for white cards with a faint green bias. `--ink-6` is the lightest ink permitted on functional small text (the 11px floor rule, unchanged from the prior world).

### Crop Accents (`cropAccent()`, `src/components/engrave.tsx`)
Every commodity carries its own `{ wash, ink }` pair instead of one uniform green, used for card media wells and filter category chips — never for dense ledger rows, which stay in the neutral ink ramp for scannability:

| Crop | Wash | Ink |
|---|---|---|
| Maize | `#fdf1d3` | `#a3690c` |
| Tomato | `#ffe1da` | `#c8482d` |
| Yam | `#f5e3d1` | `#96602c` |
| Rice | `#f7ecd4` | `#a8862c` |
| Groundnut | `#f2e0cd` | `#8a5a34` |
| Pepper | `#fde1e1` | `#c23434` |
| Onion | `#f4e2f2` | `#8a3f82` |
| Plantain | `#eef4d3` | `#6d8a1f` |

A commodity outside this table falls back to `forest-wash` / `forest`. Adding a crop to the registry should add it here too.

### Crop Photography (`cropPhoto()`, D-043)
Each commodity also has a real, self-hosted representative photo (`public/images/crops/`, credited in `public/images/CREDITS.md`) — pure iconography on filter chips and farmer-dashboard thumbnails, but on a **Marketplace lot card** it stands in only when a lot has no seller-submitted photo, and always carries a "Representative photo" label overlaid on the image. It is never used on `PublicTrace.tsx` (the public chain-of-custody page), where a stock photo would read as verified evidence rather than illustration — that surface keeps the `cropAccent()` icon-only treatment.

### Named Rules
**The Brand-Green Rule.** `--forest` is reserved for the masthead, primary actions, and positive/live/done states. It is never diluted into the neutral ink ramp and never used for a merely-decorative fill.

**The Produce-Color Rule.** A commodity's own accent (wash + ink) applies to hero media wells and category icon chips — the surfaces where "what is this" matters at a glance. Dense list/table rows keep neutral `--ink-7` icons so a ledger of many rows stays calm and scannable, not a wall of clashing color.

**The Gold-Ink Rule.** Gold text at small sizes on tinted washes is set in `--gold-ink`, never raw `--gold`. Raw `--gold` is reserved for money figures, carets, focus rings, and accent flourishes.

## Typography

**Face:** Hanken Grotesk, one variable file (weight 400–800), self-hosted woff2, no network fonts.

**Character:** One confident grotesque doing every job — mastheads, body copy, money, labels — differentiated by weight and tracking rather than a family switch. `font-variant-numeric: tabular-nums` is set globally so money and counts always align.

### Hierarchy
- **Display** (`.display`, weight 800, tracking -0.01em): mastheads, plate headers, page titles, big brand moments.
- **Body** (weight 400/600, 14px): document text, table cells, form controls. Secondary prose drops to 12–13px in `--ink-6`.
- **Serial** (`.serial`, tabular figures, weight 600): money, lot codes, timestamps, phone numbers, distances. Large money is 24px bold in `--gold-deep`.
- **Label** (`.smallcaps`, weight 700, 11px, tracking 0.08em, uppercase): column heads, field labels, nav items, captions.

### Named Rules
**The 11px Floor Rule.** Functional text never drops below 11px, and `--ink-6` is the lightest ink permitted on functional small text and placeholders — unchanged from the prior world; still sunlight-legibility-driven and still detector-enforced.

## Layout

A centered document sheet, unchanged in structure from the prior world: content capped at **1400px**, main content padded 24px. The masthead is a solid forest-green plate in two bands — an identity row (F2M seal, wordmark, search, verified-identity chip, language legend) and a nav strip below a 3px gold accent line, with gold-underlined active tabs.

The marketplace composes as a **filter sidebar + card grid**: a 208px (`w-52`) left aside of grouped filters (crop-type checkboxes now carry a colored icon chip per commodity), and a responsive card grid — 1 column on phones, 2 at `md`, 3 at `xl`, 16px gaps. Responsive behavior is parity, not degradation: on phones the filter sidebar folds behind a "Filters" summary toggle; wide tables scroll inside their own frame rather than the page.

## Elevation & Depth

**Real cast shadows**, the clearest reversal of the paper world's "depth is printed" rule: `.certificate` cards carry a soft two-layer shadow (`0 1px 2px rgba(22,36,30,.05), 0 12px 28px -14px rgba(22,36,30,.18)`) and a 20px radius. Buttons and filter chips carry a light `shadow-sm`. Modal scrims stay ink at 70% opacity.

## Shapes

Rounded, not square. Three radius steps: **control** (8–12px: inputs, small row chips), **card** (20px: `.certificate`), **pill** (`rounded-full`: every button — primary, ghost, segmented controls, the call-to-negotiate action, category icon chips, the small brand accent bar). Full circles remain reserved for seals, grade badges, avatars, and crop-icon chips.

### Named Rules
**The Pill Rule.** Every clickable action — primary, ghost, or segmented — is `rounded-full`. Structural containers (cards, panels) use the 20px card radius. Nothing in between; a stray `rounded-lg`/`rounded-xl` control reads as a regression to the retired world, not a new intentional step.

## Components

Component APIs live in `src/components/ui.tsx`; pages own layout only. Icons live in `src/components/engrave.tsx`.

### Buttons
- **Primary** (`btnCls`): solid `--forest`, pill radius, `shadow-sm`, white text; hover deepens to `--forest-deep`; disabled 40% opacity.
- **Ghost** (`btnGhostCls`): pill radius, 1px `--ink-5` border, ink text; hover tints `--paper-deep`.
- **Call-to-negotiate** (channel lots): pill, oxide-red bordered, red text, phone glyph + typed number.
- **Focus:** global `:focus-visible` — 2px `--gold` outline, 1px offset.

### Cards / Containers
- **The Certificate** (`.certificate`, `Card`): white interior, 20px radius, soft cast shadow, thin `--ink-1` border. `Card` titles are smallcaps `--ink-6` over a hairline rule. Market lot cards compose: crop-accented media well (real photo, or the crop's own wash + line icon) with grade seal and ready-date pill overlaid, subject line, ruled value line (serial-bold gold money), then a ghost "View Trace" + primary "Place Bid" pill pair.
- **The Plate** (`.plate`): solid forest field with white text — masthead, modal and payout headers.

### Inputs / Fields
- **Style** (`inputCls`): 1px `--ink-3` border on white, 12px radius, 14px ink text; caret gold.
- **Search fields** (masthead, filter): pill radius, not the 12px control radius — a search box is closer to a button in affordance.
- **Field:** every input labeled by a smallcaps `--ink-6` caption above it.

### State Stamps (`StateBadge`, `.stamp`)
- Pill-radius chip, bold uppercase 11px, wash background per the five-tone state vocabulary above. Live states carry a 6px `ember`-pulsing dot.

### Grade Seals (`GradeBadge`)
- 24px filled circle (not an outline ring): A = `--forest`, B = `--gold-deep`, C = `--stamp`, REJECT = `--ink`, white letter, `shadow-sm`. A small stamp of color, legible at a glance across a whole grid of cards.

### Crop & Category Icons
- Filter-sidebar rows and hero media wells wrap the existing line-art `CropMark` in a `cropAccent()`-colored circle/panel (wash background, ink-colored stroke via `currentColor`). Dense ledger rows (Orders, Contracts, Prices tables) keep the icon in neutral `--ink-7` — color is reserved for surfaces where identifying the crop at a glance is the point.

### Ledger Tables (`tableCls` family)
- Unchanged from the prior world: smallcaps `--ink-6` column heads over a hairline rule, 12×10px cells, numerics in `.serial`. Selectable rows: on = `--gold-wash` + semibold ink, off = `--ink-6` with `--paper-deep` hover.

### The Engraving Plate (icon system, `engrave.tsx`)
Unchanged: 24-unit viewBox line art, `stroke="currentColor"`, strokeWidth 1.4, `fill="none"`. **CropMark** (8 crop vignettes, now paired with `cropAccent()` for color), **VehicleMark**, **Glyph** (document glyphs), **Rosette**/**F2MSeal**. No emoji, no icon fonts.

### The Route Spine (`RouteSpine`, `ContractDetail`'s stepper)
Six stations (Register → Match → Contract → Grade → Pay → Trace): done legs and stations are solid `--forest` (was `--ink`) — a completed step reads as a positive green checkmark, not a neutral mark; the active station burns a gold `ember` ring; pending stays `--ink-2`/`--ink-3`.

### Motion
Unchanged three families, all `prefers-reduced-motion`-guarded: **seal-land** (a confirmation lands with scale-overshoot), **route-ink** (spine legs draw themselves in), **ember** (damped gold pulse on live states).

## Do's and Don'ts

### Do:
- **Do** use `--forest` for the masthead, every primary action, and positive/done/live states — and only those.
- **Do** give every commodity its own `cropAccent()` wash+ink on hero media wells and category chips; keep dense table rows neutral.
- **Do** make every clickable action `rounded-full`; keep structural containers at the 20px card radius.
- **Do** set money and counts in `.serial` (tabular figures); large money is serial bold `--gold-deep`.
- **Do** render seller/place identity through the `sellerName()` / `placeName()` guards in `src/api.ts`.
- **Do** keep Hanken Grotesk self-hosted from `public/fonts` with a real fallback stack.

### Don't:
- **Don't** reintroduce the retired paper world's square corners, printed-only depth, or Cinzel/Courier Prime multi-font voice — that world is evidence of what this product isn't, not a fallback to blend with.
- **Don't** fill a primary action or a positive/done state with neutral `--ink` — that reads as the retired world's flat charcoal, not this one's brand green.
- **Don't** color every small inline icon in a dense list — crop color is for hero surfaces, not ledger noise.
- **Don't** set functional text below 11px or lighter than `--ink-6`.
- **Don't** use emoji, icon fonts, or filled glyphs — new icons are drawn on the existing engraved plate at stroke 1.4.
- **Don't** add a fourth motion family or any animation that ignores `prefers-reduced-motion`.
