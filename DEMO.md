# Demo guide

Two ways to watch one lot move from a farmer's basic phone to a settled payment — now with a voice-call accept and a driver carrying the load.

## The scripted demo (2 minutes, fully offline)

```
npm run db:reset     # once — seeds commodities, rubrics, regions, rate card, demo buyer
npm run demo
```

Drives the entire spine through the real HTTP surfaces (USSD webhook, **IVR voice wire**, REST API): farmer registers and lists by USSD, a driver registers by USSD, the buyer posts demand, the farmer **accepts the offer by phone call (press 1)**, the buyer requests transport, the nearest driver takes the job and confirms pickup (auto-confirming the contract), grading runs, the buyer confirms delivery, and both the farmer and the driver get paid. Prints the trace, all SMS, and the dual-escrow ledger. Exits 0 only if the contract reaches SETTLED **and** the job reaches PAID with both escrows at zero.

To run it against **real providers** instead of mocks, set in `.env` (see `.env.example` for the account setup for each):

```
GRADING_PROVIDER=hf      # + HF_TOKEN — real vision-model grading
PAYMENT_PROVIDER=momo    # + MoMo sandbox keys — real requesttopay/transfer
```

## The three-tab manual demo (the one to show a real buyer)

Start everything:

```
npm run dev              # server on :3000, buyer portal on :5173
```

**Tab 1 — the farmer's phone:** `http://localhost:3000/ussd-tester.html`. Speaks the exact Africa's Talking webhook format; the **SMS OUTBOX** panel shows every text the platform sends this number as it happens.

**Tab 2 — the same phone, ringing:** `http://localhost:3000/ivr-tester.html` (set the same phone number). When the platform queues a voice call, this handset rings; **Answer** speaks the exact AT Voice callback format, and the keypad drives the flow.

**Tab 3 — the buyer portal:** `http://localhost:5173` — `buyer@demo.ftm` (password printed by the seed). Watch the **ALERTS** bell as the engine works.

Then walk the spine:

1. **Register** (tab 1): Dial → `1` Register as a farmer → name → region → district → confirm. Optionally dial again with a second phone number and `2` Register as a driver (name → region → vehicle → PIN).
2. **List** (tab 1): Dial → `1` Sell produce → Maize → 50kg bag → `10` → Grade B → Now → confirm.
3. **Match** (tab 3): New demand → Maize, 10 × 50kg bag, min band B, base 4.00 → Post. Matches shows the ranked, explainable score — and tab 2 **starts ringing**.
4. **Contract by voice** (tab 2): Answer → hear the terms → press `1`. (Or accept on USSD in tab 1: `2` My offers → `1` → `1`.)
5. **Hold** (tab 3): within seconds the contract shows FUNDS HELD with the hold journal; the ALERTS bell ticks.
6. **Transport** (tab 3): the contract page's TRANSPORT section shows the rate-card quote → Request transport. The driver's phone (tab 1, driver number) gets the SMS; dial → `1` Job offers → accept → `2` My job → Confirm goods loaded — the produce pickup auto-confirms.
7. **Grade** (tab 3): Upload a photo (`demo-assets/*.jpg` work) → Run grading. Band, confidence, per-criterion reasons.
8. **Release** (tab 1 farmer / tab 3): farmer dials `3` My lots → sees grade + reason → `1` Agree; buyer clicks **Confirm delivery received** → driver payout releases.
9. **Trace** (tab 3): SETTLED + driver PAID; the trace timeline now shows the voice call, the transport leg, and both payouts in one record.

If the grader returns REJECT (it happens — that's the honest path), the hold refunds in full, the lot goes back on the market, and you can post a new demand and run it again.

## Exercising the real Africa's Talking sandbox

1. Create an AT account → Sandbox app → USSD → create a service code.
2. `ngrok http 3000` (claim the free static domain so the callback URL survives restarts).
3. Set the USSD callback to `https://<your-domain>/ussd`.
4. Use AT's web simulator to dial — the same flows, over their gateway.
