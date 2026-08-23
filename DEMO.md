# Demo guide

Two ways to watch one lot move from a farmer's basic phone to a settled payment.

## The scripted demo (2 minutes, fully offline)

```
npm run db:reset     # once — seeds commodities, rubrics, regions, demo buyer
npm run demo
```

Drives the entire spine through the real HTTP surfaces (USSD webhook + REST API) and prints each step, the trace timeline, and the balanced ledger. Exits 0 only if the lot reaches SETTLED with a zero escrow balance.

To run it against **real providers** instead of mocks, set in `.env` (see `.env.example` for the account setup for each):

```
GRADING_PROVIDER=hf      # + HF_TOKEN — real vision-model grading
PAYMENT_PROVIDER=momo    # + MoMo sandbox keys — real requesttopay/transfer
```

## The two-tab manual demo (the one to show a real buyer)

Start everything:

```
npm run dev              # server on :3000, buyer portal on :5173
```

**Tab 1 — the farmer's phone:** open `http://localhost:3000/ussd-tester.html`. This page speaks the exact Africa's Talking webhook format, so everything it does works unchanged on the AT sandbox.

**Tab 2 — the buyer portal:** open `http://localhost:5173`. Log in as `buyer@demo.ftm` (password printed by `npm run db:reset`).

Then walk the spine:

1. **Register** (tab 1): Dial → `1` Register → type a name → pick a region → district → confirm.
2. **List** (tab 1): Dial again → `1` Sell produce → Maize → 50kg bag → `10` → Grade B → Now → confirm. Note the lot code.
3. **Match** (tab 2): New demand → Maize, 10 × 50kg bag, min band B, base price 4.00 → Post. The demand fulfills instantly; open **Matches** to see the ranked, explainable score.
4. **Contract** (tab 1): Dial → `2` My offers → open the offer — the **price-per-grade table** is on the phone screen → `1` Accept.
5. **Hold** (tab 2): within ~10 seconds the contract shows FUNDS HELD, with the hold journal in the ledger panel.
6. **Grade** (tab 2): Upload a photo (`demo-assets/*.jpg` work) → Confirm pickup → Run grading. The grading card shows band, confidence, and per-criterion reasons.
7. **Release** (tab 1): Dial → `3` My lots → open the lot — the farmer sees the grade, the payout, and the reason → `1` Agree. (Or `2` Dispute to trigger the one final re-grade.)
8. **Trace** (tab 2): the contract flips to SETTLED; open **Full trace timeline** — the append-only record of everything that just happened.

If the grader returns REJECT (it happens — that's the honest path), the hold refunds in full, the lot goes back on the market, and you can post a new demand and run it again.

## Exercising the real Africa's Talking sandbox

1. Create an AT account → Sandbox app → USSD → create a service code.
2. `ngrok http 3000` (claim the free static domain so the callback URL survives restarts).
3. Set the USSD callback to `https://<your-domain>/ussd`.
4. Use AT's web simulator to dial — the same flows, over their gateway.
