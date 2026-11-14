# Phase 2 — the farmer on a basic phone (design)

From the owner's vision document §5.1–§5.5 and §8: a farmer with a basic
phone can list produce by voice, hear it read back and confirm it before it
goes live, replay any instruction, manage listings, answer and counter offers,
and ask for transport, all in their own language, without reading long texts.

## What a call can do (the engine)

USSD carries menus, the voice call carries speech, SMS carries the receipt
(vision §5.3). The call engine (`apps/server/src/ivr/`) gains:

| Input | XML | Used for |
|---|---|---|
| one key | `<GetDigits numDigits="1">` | menus |
| a number | `<GetDigits finishOnKey="#">` | quantities, prices |
| speech | `<Record>` | what the farmer says |
| a number **or** speech | `<GetDigits finishOnKey="#">` then `<Record>` | "type it and press hash, or wait for the beep and say it" |

**The same keys everywhere**, like the USSD menus:

- **9** hears the instruction again (on a number step: **\***, since 9 is a digit there).
- **0** goes back one step.
- **#** ends a typed number.
- Nothing pressed: the instruction plays again, at most twice, then the call
  says goodbye and sends an SMS with the USSD route.

**Memory per call:** a call keeps its draft (`voice_calls.state`, JSON), so a
listing can be built over several answers. Calls *to* the listing line get a
call row too, so they work the same way as calls F2M places.

**Speech:** a recording goes to ASR (in the farmer's language), then MT
(to English), then the parsers. The original recording and transcript are kept
with the listing (`voice_listings`), so unclear answers can be reviewed and the
models improved (vision §5.3).

**Slow voices:** a sentence that has never been spoken before (a readback with
the farmer's own numbers) can take the Space longer than a call can wait. On a
miss the call plays a short "one moment" in the farmer's language and returns
to the same step (`<Redirect>`), when the clip is usually ready. After two
misses the text is spoken by the gateway voice.

## Listing by voice (§5.2)

Reached by calling the listing line, or from USSD "Sell → 8. Speak your listing — we call you back"
(the farmer pays nothing for the call).

1. **Tell us:** "Tell us what you are selling: the crop, how many bags,
   your price per bag, and when it was harvested." One recording.
2. **Understood so far:** the parser takes whatever it can from that sentence.
   That covers crop, quantity and unit, price per unit, harvest date ("yesterday",
   "three days ago"), ready date ("tomorrow", "next week"), and quality words.
3. **Ask only what is missing or unclear** (vision: "must not blindly
   publish"), one question at a time, each with keypad or speech:
   - crop: speech, or a keypad list read four at a time;
   - quantity: typed or spoken; the unit is a short keypad menu if the crop has several;
   - price per unit: typed or spoken; 0 means "let buyers make offers";
   - harvest: 1 today, 2 yesterday, 3 this week, 4 earlier;
   - ready: 1 now, 2 tomorrow, 3 next week (perishables: now or tomorrow);
   - quality: two yes/no questions written for that crop (dry? clean?), giving
     the declared grade;
   - place: the district from registration ("press 1 if right"), and an
     optional spoken community name.
   A field that is not understood after two tries falls back to the keypad.
   The farmer is never asked to type letters.
4. **Read back** (vision step 8): "You are listing 99 bags of rice at 2,000
   cedis a bag. Harvested yesterday, ready now, in Tolon. Press 1 to publish,
   2 to change something, 3 to cancel." Change → "1 crop, 2 quantity,
   3 price, 4 dates, 5 quality, 6 place" → back to the readback.
5. **Publish:** the listing goes live through `registerLot` (channel `ivr`),
   the SMS receipt is sent, and the call says the lot code.

## Offers by voice (§8)

The offer call reads the proposal. **1** accepts, **2** rejects, **3** counters,
**4** hears it again. Counter: "Type your price per bag and press hash, or say
it", then the number of bags (hash keeps the same), then a readback with
1 to send and 2 to change. The spoken form "I can sell the 10 bags but I want
2,100 cedis per bag" gives both numbers in one go. When a buyer counters, the
farmer's phone rings again, as well as getting the SMS.

## Listings and offers by voice (§5.5)

A registered farmer calling the listing line hears: 1 sell, 2 my listings,
3 offers waiting. For each listing: "99 bags of rice at 2,000 cedis a bag."
It offers 1 change quantity (sold some, or added more), 2 change price,
3 change ready date, 4 sold elsewhere, 5 remove, 6 next. Offers waiting go
through the same steps as the offer call.

## Transport by phone (§10.2)

USSD → My lots → an order with the payment secured → "2. Ask for transport".
This is the farmer-suggested delivery that already exists on the web: the buyer
approves and funds it.

## Not in Phase 2

Voice-guided registration (§5.1, Phase 4 with verification), spoken
transport requests, and a buyer–farmer bridged call (the `bridge` flow stays a
stub).
