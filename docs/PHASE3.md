# Phase 3 — order → delivery → payment (design)

From the vision document §9–§12 and §20, and the owner's decisions
(2026-11-14):

- the farmer is paid **part at pickup, the rest on receipt**;
- the driver is paid on delivery;
- the buyer **proposes a deduction** for a problem, the farmer **accepts or refuses**, and
  **F2M reviews every claim**: a refused claim waits for F2M's decision;
- a delivery confirms itself **24 hours** after it arrives if the buyer says nothing.

All money stays simulated (`PAYMENT_PROVIDER=mock`) until a licensed provider
is chosen (Phase 6, `docs/COSTS.md` §6).

## The order's stages

| Vision stage | F2M state | Who moves it |
|---|---|---|
| Order created, farmer acceptance, agreement confirmed | `ACCEPTED` | the accepting party (Phase 1) |
| Payment secured | `FUNDS_HELD` | the payment provider |
| Produce collected | `PICKUP_CONFIRMED` | driver (or farmer/buyer without transport) |
| Quality verification | `GRADED` (AI grade at pickup) | system |
| Delivery in progress | `GRADED`, job `PICKED_UP` | driver milestones |
| Arrived | `DELIVERED` (receipt clock starts) | driver "arrived"; with no transport job, once the farmer agrees to the grade or the grade-dispute window has passed (so delivering never cuts the farmer's dispute short) |
| Buyer confirms receipt | `RECEIVED` | buyer, or the 24 h clock |
| Problem reported | `CLAIMED` | buyer, before the clock runs out |
| Payment settled, transaction completed | `SETTLED` | the farmer's last payout landing |

## Money

The hold is `agreedTotal` (exact; legacy per-grade orders use `finalAmount`).

1. **Advance** at grading (any grade but REJECT): `FARMER_ADVANCE_PERCENT`
   (default **30**) of the total goes to the farmer's MoMo. REJECT still
   refunds the buyer in full and pays no advance.
2. **Balance** on receipt: the total minus the advance minus any agreed deduction.
3. **Refund** to the buyer at settlement: the deduction, plus any legacy
   difference between the hold and the total.

The journals stay balanced and the escrow ends at 0. The ledger gets one line pair per payout as it
lands, plus the refund at `SETTLED`. **A deduction can never exceed what is still
held.** The advance is already on the farmer's phone and is never pulled back.
A larger loss is an F2M review matter.

The **driver** is paid when the order is received (buyer or clock). If the
claim says *not delivered* or *damaged in transport*, the driver's pay waits
for F2M's review too.

## Claims (vision §20)

The buyer reports a problem on a delivered order, before the 24 h clock runs out.
A claim has a reason (short weight, quality not as agreed, damaged, late, not
delivered, other), a note, and a proposed deduction (≤ what is still held).

- The farmer hears it by SMS and a call (1 accept, 2 refuse), or on USSD
  (My lots → the order). They have 24 h to answer; silence counts as a refusal.
- **Accepted:** settles at once with the deduction.
- **Refused:** the undisputed part is paid now. The disputed part waits for an
  F2M reviewer, who decides the deduction (from 0 up to the buyer's proposal).
- **Every claim is listed for F2M review**, including accepted ones (an audit).
  The reviewer screen is Phase 4's admin. Until then the decision is made
  through a simulator-only route (`POST /api/dev/claims/:id/resolve`).

## Quality, four kinds (vision §12)

The order record keeps them apart:

- **declared:** the listing's declared grade, from the farmer;
- **AI-assessed:** the grading at pickup, with confidence and reasons;
- **inspected:** an independent inspector, Phase 4;
- **buyer-confirmed:** received with no claim, or a claim about quality.

## Driver milestones (vision §10.4)

Job accepted → arrived at pickup → produce collected → delivery started →
arrived at destination. The buyer confirms delivery. Each step is on USSD for
basic-phone drivers and in the API. The buyer is notified at each step, and the
farmer when the produce is collected and when it is received.

## Not in Phase 3

Real money (Phase 6); the admin reviewer screen, inspectors and ratings (Phase 4).
