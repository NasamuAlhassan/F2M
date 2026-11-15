# The intelligence layer

Live prices, live screens, alerts to the right people, and an optional
language-model assist. Decisions D-053 to D-056 in [DECISIONS.md](DECISIONS.md).
Price details: [PRICES.md](PRICES.md).

The rule through all of it: **code decides, the model only suggests.** Prices,
matches, alerts and advice are arithmetic and rules over the data and can be
explained in a sentence. The optional language model reads a sentence and
proposes fields; whatever it proposes is checked and a person confirms it.

## 1. Live prices (D-053)

- `price_observations` (migration 0015) keeps every price with its source.
- Listing, bidding, agreeing and requesting each record one automatically.
- `priceIntel.ts`: fair-price range, trend, series, seasonal outlook, and a
  verdict on any typed price (`very_low`, `low`, `fair`, `high`, `very_high`).
- The verdict is shown in the web listing and request forms, in the USSD sell
  step (a warning before the farmer presses 1, never a block), and on the new
  Prices page, which also has a "check a price" box.
- Prices page: crop cards with trend and sparkline, a chart (line, usual range,
  hover and keyboard, table view), where each crop is listed and wanted by region.

## 2. Live screens (D-054)

- `GET /api/stream` is a server-sent-events stream. A message names the topics
  that changed (`market`, `prices`, `offers`, `notifications`, `demands`, `alerts`)
  and nothing else; the web then re-reads through the normal authenticated API,
  so the stream cannot leak data. Bursts within 250 ms are one message.
- Publishing happens where state already changes (lot events, offers, requests,
  notifications, price records). It never throws.
- In-process by design: one server on one SQLite file. A second server would
  swap `domain/events.ts` for a shared bus; nothing else changes.
- The web streams with `fetch` (the Authorization header), reconnects with
  backoff, and the existing polling stays as the safety net. A "Live" dot shows
  in the footer while connected.

## 3. Alerts and "who has what" (D-055)

- A new listing reaches buyers who asked to watch that crop, have an open
  request for it, or bought it before, nearest first. A buyer the matching
  engine already bid for is not told twice.
- A new buyer request reaches farmers who have listed that crop in the last
  year and have nothing listed now, within a reach set by the crop's distance
  decay. Each gets an SMS in their language.
- Price lines ("tell me when maize goes above GHS 5") and sharp moves (10% in two
  weeks) alert the people they touch. A line speaks once, then rests a week.
- Limits (config): `ALERT_MAX_RECIPIENTS` (8) per listing or request,
  `ALERT_SMS_PER_FARMER_PER_DAY` (2), `ALERT_PRICE_MOVE_PCT` (10). Every alert is
  logged (`alert_log`, migration 0017) so the same news is never sent twice.
- Alerts are rules, not AI, and each says why it reached you.
- "Who has what": `supplyDemandByRegion` totals kilograms listed and wanted per
  region, no names. It is on the Prices page.
- Manage alerts: `GET/POST/DELETE /api/watches`, or the "Alerts" card on a crop.

## 4. The language-model assist (D-056, D-059)

**Off by default.** With `LLM_PROVIDER=off` nothing leaves the server and every
feature runs on its rules exactly as before. It runs on **open models** on an
OpenAI-compatible host, Groq by default (free tier). To switch it on, set
`LLM_PROVIDER=openai-compatible` and `LLM_API_KEY` (a key from console.groq.com).
`LLM_MODEL` (default `openai/gpt-oss-120b`), `LLM_BASE_URL` (default
`https://api.groq.com/openai/v1`) and `LLM_TIMEOUT_MS` tune it. Another host
(OpenRouter, Hugging Face's router, a self-hosted server) is a change of those
three settings. The photo check needs `LLM_VISION_MODEL`, a model that can see;
unset, that check is skipped.

**What goes out, and what does not.** Only short text being understood: a
farmer's translated listing sentence, a buyer's typed request, a failed-call
transcript for the triage script, or a listing photo for the photo check.
Phone numbers and e-mail addresses are removed first. Names and ids are never
sent. The owner approved sending this to an open-model host (D-059).

What it does:

| Use | Where | Guard |
|---|---|---|
| Fill gaps in the one-breath voice listing | First answer on a listing call | Fills only fields the rules left empty. Crop and quality are never taken from it. A number must be one she said; a unit must be singled out by her own words ("bags" of a two-size crop stays asked). Everything is read back and published only on 1. Saved with the record as `aiFilled`. |
| Read a buyer's plain-words request | "Describe what you need" box on the request form | Fills the form only; the buyer checks and posts. Numbers must be ones they typed; regions and crops must exist. |
| Check a listing photo shows the crop | `POST /api/farmer/lots/:id/photo-check` | Advisory; blocks nothing. |
| Group failed voice listings | `npm run ai:triage -w @ftm/core` | Report for a human; applies nothing. |

Not model-driven on purpose: price guidance, offer advice
(`GET /api/offers/:id/advice` accepts or counters from the market range), matching,
alerts. They work with the assist off.

Any failure (down, slow, refused, malformed, fails validation) returns nothing
and the feature carries on without it. The provider calls the host's
chat-completions endpoint in JSON mode, with the schema in the instructions;
the Zod check afterwards is what enforces it. A fenced or chatty answer is
unwrapped before parsing.

## Operating notes

- Seed prices are `reference` and age out after 180 days, after which a crop
  with no live evidence shows "no recent price".
- Alerts run from the sweep (every 60 s) and from the listing/request that
  triggers them; price feeds are pulled by the sweep when configured.
- The web does not yet use negotiation threads, so offer advice has an API but no
  web card until it does.
