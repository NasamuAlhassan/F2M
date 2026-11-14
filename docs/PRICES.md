# Live prices

How F2M knows what a crop is worth now, which way it is moving, and whether a
price someone typed makes sense. Design: [INTELLIGENCE.md](INTELLIGENCE.md).

## Where prices come from

Every price lands in one table, `price_observations`, tagged with how far to trust it:

| Source | Meaning | Weight |
|---|---|---|
| `deal` | A price a buyer and farmer agreed in a negotiation | 1.0 |
| `market` | A market report: WFP history, a partner feed, a hand-entered quote | 0.8 |
| `ask` | A farmer's asking price on a listing | 0.5 |
| `offer` | A bid or counter-offer | 0.35 |
| `request` | What a buyer will pay for the lowest grade in a request | 0.35 |
| `reference` | The seed's placeholder quotes | 0.15 |

Deals, asks, offers and requests are recorded **automatically** as people list,
bid, agree and ask. Nobody enters them. The fair-price estimate is a weighted
median that favours recent evidence (weight halves every 21 days, nothing older
than 180 days counts), trims stray outliers, and says how confident it is. With
only placeholders to go on it says "reference", and with nothing recent it says
nothing rather than showing a stale number as today's.

## The honest state of outside data (checked 2026-11-14)

- **WFP's Ghana series on HDX** (from MoFA, via FAO; CC BY-IGO) is real and
  useful: 2006 to July 2023, about 16 markets including Tamale, Bolga, Wa,
  Techiman, Garu and Yendi. It **stops in July 2023**, so F2M uses it for the
  shape of the year (seasonality) and long history charts, not for today's price.
- **MoFA weekly prices** have no public API we could verify.
- **FAO FPMA** has newer data but no API we could verify.

So "latest" comes from F2M's own activity, and the way to improve it is to feed
in a current source (below).

## Loading the WFP history

```bash
npm run prices:import -w @ftm/core                    # downloads from HDX
npm run prices:import -w @ftm/core -- path/to/wfp.csv # or from a file
```

Or set `PRICE_FEED_HDX=true` and the server loads it once at start if the
database has none. Safe to repeat. It keeps wholesale cedi prices of the crops
F2M trades, converts each to pesewas per kg, and maps markets to today's regions.

## Plugging in a current source

Any partner, price collector or scraper can send current prices in this shape,
either by **POST** (set `PRICE_INGEST_TOKEN`, at least 16 characters; the
endpoint is closed while it is empty):

```bash
curl -X POST https://YOUR-SERVER/api/feeds/prices \
  -H "Authorization: Bearer $PRICE_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "dataset": "my-collector",
    "observations": [
      { "commodity": "MAIZE", "market": "Techiman", "regionCode": "BONO_EAST",
        "ghsPerKg": 4.4, "observedAt": "2026-11-14" },
      { "commodity": "ONION", "market": "Tamale", "regionCode": "NORTHERN",
        "ghsPerUnit": 300, "unitKg": 50 }
    ]
  }'
```

or by **polling**: set `PRICE_FEED_URL` (and `PRICE_FEED_TOKEN` if it needs a
bearer token) and the server fetches that URL every `PRICE_FEED_INTERVAL_MINUTES`
(default 360) and expects the same JSON.

- `commodity` is an F2M crop code (`MAIZE`, `TOMATO`, `YAM`, ...).
- Give `ghsPerKg`, or `ghsPerUnit` with `unitKg`. Amounts are cedis.
- `observedAt` is an ISO date or epoch ms; it defaults to now and may not be in the future.
- `dataset` names the reporter (letters, digits, `.`, `_`, `-`). The same
  dataset, crop, market and day is one row, so re-sending a day updates it.
- The response lists any rows it could not use and why.

## Reading prices

All public, no login:

- `GET /api/prices/overview?regionCode=` every crop: price, trend, sparkline, kg listed and wanted.
- `GET /api/prices/crop/:code?regionCode=` one crop in depth: series, long history, seasonal outlook, markets, where it is and where it is wanted.
- `GET /api/prices/check?commodity=&unit=&price=&side=sell|buy&locale=` is this price sensible? `price` is pesewas, per `unit` when given, else per kg. The sentence comes back in the person's language and is the same one USSD shows.

## Trends and the seasonal outlook

A trend compares the last 30 days with the 30 before, and is shown only when
both have at least two real observations. The seasonal outlook divides each
market's monthly price by a baseline that runs between its neighbouring years'
averages (so inflation is not mistaken for season), then averages by calendar
month; it appears only with four or more years of history, and only when the
expected move over two months is at least 5%. On the real WFP data, maize
peaks in July and bottoms in October, matching Ghana's lean season and harvest.
