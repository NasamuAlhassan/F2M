# Phase 1 — the two-way marketplace (design)

From the owner's vision document §7–§9 and the owner's answers (2026-11-14):
the farmer lists with their own asking price; buyers bid on the listing;
both sides counter back and forth until one accepts; buyer requests are
visible to every farmer; each side can walk away.

## The one idea: every offer is a negotiation

Today an offer is a contract the matching engine creates at the buyer's
price, which the farmer can only accept or decline. In Phase 1 every offer is
an **offer thread** between one buyer and one farmer about one listing,
whoever starts it:

| Started by | How |
|---|---|
| A buyer, bidding on a listing | Marketplace → bid (quantity in the listing's unit, price per unit) |
| A farmer, answering a buyer request | Requests → pick a listing → quantity, price per unit |
| The matching engine, from a buyer request | A request that fits a listing becomes a buyer bid at the request's price |

Each thread holds the **current proposal** (units, price per unit) and whose
turn it is. The party whose turn it is can:

- **accept** — the order is created (below);
- **counter** — a new quantity and/or price; the turn passes to the other side;
- **reject** — the thread ends.

The party waiting can **withdraw** their proposal. A proposal **expires** after
the commodity's offer clock (`offerTtlMinutes`: 2 h for tomato, 24 h for
maize…), restarted by each counter. Every move is recorded (`offer_events`),
and both sides are told about it by SMS and in-app alerts.

## What accepting does

One transaction:

1. Checks the listing still has the bags (a listing is not reserved by an
   open bid — many buyers can bid on the same listing; the first acceptance
   wins, a later one that no longer fits is refused with a clear message).
2. Creates the order as a **contract in state ACCEPTED** with the agreed total
   (`units × price per unit`, exact) and the per-kg price, linked to a demand
   and a match like every contract today, so payment, pickup, grading,
   transport, settlement and the trace work unchanged.
3. Takes the bags off the listing. A listing with bags left stays on the
   market; at zero it leaves.
4. Starts the payment hold, as accepting does today.

Until Phase 3 reworks quality and payment, the agreed total is what the
farmer is paid whatever the grade; REJECT still refunds the buyer.

## Buyer requests

A buyer request (today's "demand") is public to farmers: commodity, quantity,
minimum quality, target price, delivery window and region. Farmers see them on
the web and in a new USSD menu, and can answer with an offer on one of their
listings. The request keeps its quantity; threads started from it hold that
quantity on the buyer's side so the engine never over-buys.

## Listings

- Asking price **per unit** (per bag, crate, bunch…), optional — "let buyers bid".
- New fields: harvest date, community, landmark.
- Manage: change quantity, change price, mark sold, remove (done), and
  **expiry** — a listing lapses after `LISTING_TTL_DAYS` (default 30) with a
  warning SMS two days before.
- The USSD sell flow gains a price step.

## New crops

Cassava, millet, sorghum, soya beans and cowpea — each with units, a
freshness clock and a grading rubric, like the existing eight.

## Phone parity in Phase 1

USSD: offers list with accept / reject / counter (price typed on the keypad),
buyer requests with "offer my produce", listing management, the price step.
Voice: the offer call says the proposal and takes 1 accept / 2 reject; spoken
counter-offers are Phase 2.

## What is not in Phase 1

Payment after delivery, quality kinds and disputes (Phase 3); verification,
admin, search filters (Phase 4); voice negotiation (Phase 2).
