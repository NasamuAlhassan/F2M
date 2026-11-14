---
name: Farm to Market — The Harvest Journal
description: An editorial agritech marketplace. Warm cream ground, plain serif headlines, deep-green feature sections, F2M green on every action.
colors:
  paper: "#efe9df"
  paper-deep: "#e5ddcf"
  paper-lift: "#fbf8f3"
  ink: "#14231b"
  ink-8: "#26352c"
  ink-7: "#3d4a41"
  ink-6: "#56625a"
  ink-5: "#7a8279"
  ink-4: "#9a9f95"
  ink-3: "#bcbdb1"
  ink-2: "#d9d3c6"
  ink-1: "#e8e2d6"
  forest: "#147f44"
  forest-deep: "#0f6d3a"
  forest-night: "#0c3d24"
  forest-wash: "#dcebd9"
  gold: "#d97a1f"
  gold-deep: "#b3620f"
  gold-ink: "#8a4c0c"
  gold-wash: "#f6e2c6"
  stamp: "#c0392b"
  stamp-deep: "#962c21"
  stamp-wash: "#f5d8d1"
  info: "#1a55c4"
  info-wash: "#dbe5f6"
  transit: "#6d3fc4"
  transit-wash: "#e6ddf2"
  success: "#18753f"
  success-wash: "#d8ecd8"
typography:
  headline:
    fontFamily: "Newsreader, Georgia, serif"
    fontWeight: 400
    lineHeight: 1.08
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Hanken Grotesk, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  eyebrow:
    fontFamily: "Hanken Grotesk"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.24em"
  label:
    fontFamily: "Hanken Grotesk"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.08em"
rounded:
  control: "12px"
  card: "20px"
  feature: "28px"
  pill: "9999px"
---

# Design System: Farm to Market — The Harvest Journal (D-048)

## Overview

F2M reads like a well-made journal about the harvest: a warm cream page, large plain serif headlines, and deep-green sections that carry the story. The brand green is unchanged and still marks every action. The look follows a reference the owner chose (innofemme.org) in structure and type, not in colour or content.

The product is used by farmers on cheap phones in strong sunlight, buyers at desks, and drivers on the road. So the editorial look sits on top of hard floors: 11px minimum for functional text, `--ink-6` as the lightest functional ink, 44px tap targets, and plain words.

## Colour

- **Cream ground** (`--paper`), **warm-white cards** (`--paper-lift`), **recessed zones** (`--paper-deep`).
- **Forest** (`--forest` #147f44): every primary button, positive and done states. **Forest deep** for hover.
- **Forest night** (`--forest-night`): the deep field. Panel and modal headers (`.plate`), the active nav pill, the landing's story sections, the footer, the toast. Put `.on-dark` on the container so eyebrows and italic words turn gold.
- **Gold**: the italic accent word (`--gold-deep` on cream, `--gold-bright` on dark), money figures and live pulses. Small gold text on a wash is `--gold-ink`; gold text on the dark field is `--gold-bright`.
- **State tones** (`StateBadge`): gold live, info assigned, transit en route, success settled, stamp disputed.
- **Crop accents** (`cropAccent()` in `engrave.tsx`) colour hero media and filter chips only, never dense ledger rows. A new commodity needs a line icon in `CROP_PATHS`, an accent whose ink is at least 3:1 on its wash, and a representative photo (about 900px wide, under 270KB, credited in `public/images/CREDITS.md`). Prefer photos from Ghana or West Africa of the produce as it is sold.
- Native checkboxes, radios and sliders use `accent-color: var(--forest)`.

## Type

- **Headline** (`.headline`): Newsreader, weight 400, tight tracking, balanced line breaks. Page titles 36–48px; card titles 20–24px; landing up to 60px. Plain text. The gold italic accent (`<em>`) is used **once on the whole site**, in the landing hero ("Sell your harvest from *any phone*"). Repeating it on every heading is a template tell.
- **Eyebrow** (`.eyebrow`): 11px, bold, uppercase, tracked. Reserved; not used on pages today. Context that used to sit in an eyebrow goes in a plain line under the heading ("One vehicle, many farmers").
- **Body**: Hanken Grotesk 14–17px. Secondary lines `--ink-6`.
- **Label** (`.smallcaps`): 11px uppercase for field labels and table heads.
- **Money and counts** (`.serial`): tabular figures, bold, large money in `--gold-deep`. The cedi is written **GHS**: Hanken Grotesk has no ₵ glyph, and GHS is what MoMo messages show.
- Fonts are self-hosted in `public/fonts`; both are preloaded in `index.html`.

## Layout and chrome

- **Signed-in header**: cream, sticky, blurred, one row. From `lg`: seal, the floating **pill nav** centred (active tab a filled forest-night pill), search, alerts, the person chip and Log out. The wordmark and the person's name return at `xl`, where they fit.
- **Phones and tablets (below `lg`)**: a **bottom tab bar** replaces the pill nav when a role has more than one section (buyer 4, farmer 2; a driver has one, so no bar). Icon plus label, 64px cells, safe-area padding, hidden while a text field has focus so it never rides on the keyboard. Toasts sit above it (`--tabbar-h`). A sideways-scrolling row of tabs is not used: people miss the tabs they cannot see.

## Phones first (360px is the baseline)

Measured in a 360×780 audit of every role. The rules that came out of it:

- **Lead with the task.** On a phone, a page reads in the order the person acts: the farmer's offers to answer, then totals, the form, sales, payouts, and settings last; the driver's jobs before vehicle and routes. Desktop columns are flattened with `contents` and `order-*` so the desktop layout is untouched.
- **No tables on phones.** Below `sm`, a table becomes a list of cards or rows: the one number that matters, a status chip, and a tap target to the detail. Tables return from `sm` up. Short reference tables (three columns or fewer) become lists at every size.
- **No scroll boxes inside the page** on phones (the driver's routes are two columns instead).
- **Dialogs are bottom sheets on phones**: pinned to the bottom, rising in, scrolling when tall. Centred from `sm` up.
- **Hand links to the phone.** Where a link is meant to be passed on (the QR record), use the share sheet (`navigator.share`) on touch devices and copy elsewhere.
- **Keyboards**: money and quantities `inputMode="decimal"`, phones `type="tel" autoComplete="tel"`, search `enterKeyHint="search"`. The viewport sets `interactive-widget=resizes-content` so the layout shrinks above the keyboard (Chrome, Firefox).
- **Data costs money.** The sign-in library loads only when someone has a saved login or signs in (`getSupabase()`), so the landing page, QR record and phone simulator skip it. The app's main script is about 100 KB gzipped; keep a page's own code under about 20 KB.
- **Words, not codes**: "500 kg maize", "Broken kernels", never `MAIZE` or `broken_kernels`.
- **Footer**: live lot count, the "payments are simulated" note, and the language switcher.
- **Landing** (`/`): header with plain section links; a hero with one sentence of promise, one paragraph, a primary button and a text link to the phone simulator, beside a photo with the real USSD menu; "How a sale works" told as one numbered example (Ama near Garu, labelled as an example); "Who it is for" as ruled rows, not cards; a short plain "why" on the dark field; the language list from the live registry; a quiet footer.
- **Login**: split screen. Story panel on the left (desktop only), form on the right. `?mode=signup` opens Create account.
- Content width 1400px (portal), 1100–1280px (landing).

## Components (`src/components/ui.tsx`)

- **Buttons**: `btnCls` (forest pill) and `btnGhostCls` (outlined pill). Both sink to 97% on press. Every clickable thing is a pill. A button waiting on the network keeps its label, shows a spinner and sets `aria-busy`; only the pressed row shows it, and a busy button never fades. The smaller shared controls (`pillCls`, `quietBtnCls`, `iconBtnCls`, `backLinkCls`, `textLinkCls`, `rowLinkCls`, `choiceCls`) live in the same file; reuse them instead of writing a new class string.
- **Card** (`.certificate`): 20px radius, warm soft shadow. A title with " — " splits into a serif title and a small subtitle.
- **Greeting**: "Good afternoon, Prince" as the page heading and one sentence that leads with what is waiting (an offer to answer, a job on the road). Every home screen starts with it.
- **EmptyState**: icon in a green circle, a serif line, one sentence, at most one action. Never a bare "No data".
- **Skeleton**: shimmering bars in place of "Loading…".
- **toast(message)**: confirms an action ("Your maize is on the market"). Mounted once as `<Toaster />` in `main.tsx`.
- **ErrorStamp**: a rounded red-wash notice with a dismiss cross.
- **Not found**: unknown links land on a friendly page with the way back.

## Words

Write for a farmer reading in their second language:

- Say what happens, not the system's name for it: "Offers waiting for you", not "Incoming Bids"; "held for you", not "escrow hold"; "Ready now", not "Same-day".
- No raw codes on screen (`UPPER_EAST` → "Upper East"), no decision numbers, no Title Case on buttons ("Place a bid").
- Count words agree with their number ("1 offer", "2 offers").
- New strings go through `t('web.<page>.<name>', 'English')` (D-050) so they can be translated.

## Accessibility and interaction floors (WCAG 2.2 AA)

Measured, not assumed. Ratios below are computed against the actual tokens.

- **Contrast.** Body and label text at least 4.5:1, large text (24px+, or 18.66px bold) at least 3:1, control borders and focus rings at least 3:1. Brand green `--forest` #147f44 gives white button text 4.78:1. On the dark field, gold text uses `--gold-bright` #e8953f (5.15:1); plain `--gold` there is only 3.95:1. Input borders use `--field-border` #80857b (3.57:1 on cards). Placeholders are #6b7369 (4.6:1). `--success` #18753f and `--info` #1a55c4 pass on their washes.
- **Focus.** One global `:focus-visible` ring: 2px `--forest-night` with a 2px offset on light grounds, `--gold-bright` inside `.plate`/`.on-dark`. Never `outline-none` on a control. `scroll-padding-top: 96px` keeps focused things out from under the sticky header (2.4.11).
- **Skip link.** `<SkipLink />` is the first element on every page shell; each `<main>` has `id="main" tabIndex={-1}`.
- **Targets.** 44px minimum on phones (`min-h-11`), 24px absolute minimum anywhere (2.5.8). Icon-only buttons carry an `aria-label`.
- **Live regions.** One polite live region (the Toaster); toasts inside it are plain elements so each is announced once.
- **Dialogs.** `Modal`/`useDialog`: focus moves in, Tab is trapped, Escape closes, focus returns to the opener, the page behind does not scroll (`overscroll-contain`), and a click on the veil closes it.
- **User settings honoured.** `prefers-reduced-motion` (every animation has an off switch), `prefers-contrast: more` (darker inks and borders), `forced-colors` (shapes keep borders, focus uses `Highlight`).
- **Touch.** `touch-action: manipulation` (no double-tap-zoom delay), no grey tap flash, 16px inputs on phones so iOS never zooms, `viewport-fit=cover` with `env(safe-area-inset-*)` for toasts.
- **State in the URL.** Marketplace filters and sort live in the query string (`?crop=MAIZE&grade=A&km=300&type=perishable&sort=nearest`), so refresh, Back and shared links keep the view.
- **Small polish.** The sticky header grows a hairline shadow only when content scrolls under it. Skeletons appear only after 150ms so fast loads never flash. Photos show a cream block while loading. Sideways-scrolling rows fade at the edge. Printing gives a clean page with no chrome.

## Motion

Three durations and two curves, set in `index.css` `:root`. Use them instead of Tailwind's numbered durations.

| Token | Value | Used for |
| --- | --- | --- |
| `--dur-fast` | 120ms | the default for any `transition-*` class: hover colour, press sink |
| `--dur-base` | 200ms | segmented items, the dialog veil, toast exit |
| `--dur-slow` | 320ms | the sliding pill, dialog and drawer entrance, toast entrance, confirmations |
| `--ease-out` | `cubic-bezier(0.16,1,0.3,1)` | everything that arrives or answers a touch |
| `--ease-in-out` | `cubic-bezier(0.65,0,0.35,1)` | things that move from one place to another on screen |

- **Sliding pill** (`SlidingPillGroup`): the highlight slides to the new choice while the content swaps at once. Used for the main nav, Login tabs, Browse/Pool, the phone persona switch and the pool crop filter. It does not slide on first paint.
- **Arrivals**: dialogs grow from the top, the Voice & SMS drawer slides in from the right, toasts grow from the bottom. Confirmation cards (offer, match, payout) rise 6px and fade in. Only the grade badge keeps a stamp.
- **Live**: the ember pulse marks something happening now (recording, live matching). Static content never pulses.
- **Nothing shifts**: hover, focus and selection change colour or a ring, never border width, font weight or size. Wave bars animate `scaleY`, not height.
- Every keyframe sits in one section of `index.css`, and one `prefers-reduced-motion` block switches them all off.

## Don't

- Don't use the reference's aubergine or coral, or its artwork.
- Don't fill a primary action with ink; actions are forest.
- Don't repeat a formula: no italic accent outside the landing hero, no kicker label over every heading, no scroll-triggered fade on every section, no word ticker, no giant watermark text, no grid of identical feature cards with three ticks each.
- Don't write slogans. "Every harvest deserves a market" says nothing; "Dial *384*7247# from any phone" says what to do. Prefer concrete places, numbers and steps.
- Don't use em dashes, "not X but Y", or lists of three by habit in visible copy.
- Don't drop functional text below 11px or lighter than `--ink-6`.
- Don't use emoji or icon fonts; icons are the line-drawn set in `engrave.tsx`.
