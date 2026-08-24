# What it costs to run this for real

Every figure here is quoted from the provider's own published rate card, with
the date it was checked. Nothing is estimated unless it is labelled as an
estimate, and anything unconfirmed says so. **Confirm current pricing with the
provider before committing spend** — rate cards move.

Currency note: Africa's Talking and MTN publish in **GHS**; Fly.io and Hugging
Face publish in **USD**. They are kept in their published currency rather than
converted, so no stale exchange rate is baked in.

---

## 1. The short answer

| Stage | What it buys | Cost |
|---|---|---|
| **Deploy and test** | Container, portal, USSD flow proven in AT's simulator | **~$7–10/month** (no free tier) |
| **Real SMS + real phone dialling** | A shared USSD code, an approved sender ID | **+ GHS 900/month** + USD 100 deposit |
| **Real IVR** | A live Ghana voice number | **+ ~GHS 345/month** (GHS 575 one-off) |
| **Real money** | Company registration + a licensed PSP | **~GHS 700 one-off, then ~2% per transaction** — see §6 |

The jump that matters is the last one. Everything before it is engineering; that
one is regulatory — and it dwarfs the rest.

**Keep the proportions in view.** A month of 1,000 transactions costs roughly $7
of hosting and $0.60 of AI. Moving the money for those same transactions, at ~2%
on GHS 2,000 lots, costs about **GHS 40,000**. Payment fees are not one line item
among several; they are essentially the entire cost of the business, and today
the product charges nothing to cover them (§6).

**Two pieces of good news:** Ghana's E-Levy was **abolished in April 2025**, and
you almost certainly **do not need your own Bank of Ghana licence** — riding a
licensed PSP covers it. But §6 explains the specific way this product's escrow
design puts that second point at risk.

Note that hosting is **not** free either — Fly has no free tier any more, and its
trial (2 machine-hours or 7 days) cannot carry an always-on pilot. See §4.

---

## 2. Africa's Talking — Ghana

_Checked 24 August 2026 against AT's Ghana rate cards and help centre._

### USSD

Sandbox is free and unlimited, but **simulator-only** — AT states plainly that
sandbox interactions happen in the simulator "and NOT the HANDSET". No real
Nokia can dial a sandbox code. For a real handset you need a live code:

| | **Shared code** | Dedicated code (all three telcos) |
|---|---|---|
| Setup | **Free** | GHS 3,500 MTN + GHS 3,500 AirtelTigo + GHS 4,500 Telecel |
| Monthly | **GHS 900** | GHS 3,500 + GHS 3,500 + GHS 4,000 = **GHS 11,000** |
| Annual regulator fee | — | GHS 2,100 (3-digit) or GHS 500 (4-digit) |
| Session cost | GHS 0.03 per session, per telco (free to the farmer) | same |
| Deposit | USD 100 | USD 100 |
| Lead time | **~2 working days** | not published for Ghana |

**Start shared.** It is ~12× cheaper monthly, has no setup cost, and provisions
in two days. Contact `ussd@africastalking.com`.

### Voice / IVR

**There is no free path.** AT's voice sandbox is officially non-operational
(their own article, February 2026), so IVR cannot be tested without a live app
and a real, paid Ghana number.

| Ghana voice number (Regular) | Cost |
|---|---|
| Setup, one-off | GHS 500 + 15% VAT = **GHS 575** |
| Monthly | GHS 300 + 15% VAT = **GHS 345** |
| Incoming | GHS 0.009/min |
| **Outgoing** | **GHS 0.20/min** |
| Text-to-speech | effectively free (USD 0.000008–0.00006) |

Must be a **Regular** number. Toll-Free, Premium and Virtualized numbers cannot
originate outbound calls, and this product calls farmers with offers.
Contact `voice@africastalking.com`.

### SMS

Ghana has **no default sender ID** — unlike Kenya, nothing sends until you
register one. Registration is **free** (≤11 characters, plus a company website
link and a sample message). AT publishes no approval SLA, so apply early: this
gates every SMS receipt in the product.

| Monthly SMS spend | Price per message |
|---|---|
| GHS 0–1,089 (Basic) | **GHS 0.050** |
| GHS 1,090–5,449 (Plus) | GHS 0.048 |
| GHS 5,450–20,999 (Premium) | GHS 0.045 |
| GHS 21,000+ (Max) | GHS 0.038 |

Uniform across MTN, Telecel, AirtelTigo and Glo. Tiers are by **spend**, not
message count.

---

## 3. What one transaction actually costs

Counted from the code, not estimated — every SMS in the product is a `queueSms`
call, and these are all of them on the happy path.

**Farmer, one lot from listing to payout** (`lots.ts`, `matching.ts`,
`paymentFlow.ts`, `gradingFlow.ts`):

| Trigger | Template |
|---|---|
| Lot listed | `sms.lotListed` |
| Matched to a buyer | `sms.newOffer` |
| Buyer funded escrow | `sms.funded` |
| Photo graded | `sms.graded` |
| Payout released | `sms.paid` (or `sms.rejected`) |

**= 5 SMS.** Plus `sms.registered` once per farmer, ever, and `sms.loginCode`
per web login.

**Driver, if the lot moves with a transport leg** (`logistics.ts`):

| Trigger | Template |
|---|---|
| Dispatch offer | `sms.jobOffer` — **one per driver tried** |
| Driver accepts | `sms.jobAssigned` |
| Delivery paid | `sms.jobPaid` |

**= 3 SMS minimum.** Dispatch is sequential nearest-first
([`logistics.ts:259`](../packages/core/src/domain/logistics.ts#L259) texts
`next.driver`), so **every driver who declines adds GHS 0.05.** In a thin
driver pool that is the one line item that can quietly inflate.

Buyer-side `notif.*` messages are in-app notification-centre entries, not SMS.
They cost nothing.

### Per completed transaction

| Item | Count | Cost |
|---|---|---|
| Farmer SMS | 5 | GHS 0.25 |
| Driver SMS | 3 | GHS 0.15 |
| USSD sessions (register, list, accept, confirm) | ~4 | GHS 0.12 |
| Outbound IVR offer call (if used, <1 min) | 1 | GHS 0.20 |
| **Total** | | **≈ GHS 0.52 – 0.72** |

Call it **under GHS 1 per completed deal** in telco cost, before hosting and
before payment fees. At 100 transactions/month that is ~GHS 70 of variable cost
against GHS 900–1,245 of fixed line rental — so at pilot scale, **the fixed
monthly cost dominates completely**. Variable cost only starts to matter in the
thousands of transactions.

---

## 4. Hosting (Fly.io)

_Checked 24 August 2026 against fly.io/docs/about/pricing._

**There is no free tier.** Fly discontinued its Hobby/Launch/Scale plans in
October 2024 — new accounts get Pay-As-You-Go only. The free trial is **2 machine-hours
or 7 days, whichever runs out first**, and adding a card ends it immediately. An
always-on pilot cannot live inside it, so budget from day one.

There is also **no mandatory plan and no minimum spend** — you pay for what runs.
(Paying by prepaid credit instead of a card carries a $25 minimum purchase; a
card avoids that.)

| Line item | London (`lhr`) | Johannesburg (`jnb`) |
|---|---|---|
| shared-cpu-1x, 1GB, 24/7 | $6.46 | $7.42 |
| 3GB volume @ $0.15/GB | $0.45 | $0.45 |
| Daily snapshots (5-day retention) | $0.00 — under the 10GB free allowance | $0.00 |
| Egress, 20GB | $0.40 @ $0.02/GB | $2.40 @ $0.12/GB |
| Shared IPv4 + IPv6, 1 TLS cert | $0.00 — first 10 certs free | $0.00 |
| **Total** | **≈ $7.31/month** | **≈ $10.27/month** |

Add **$2/month** if you need a dedicated IPv4 (only required for non-HTTP ports —
this app doesn't).

### Two traps worth knowing

**African egress costs 6× European egress** — $0.12/GB against $0.02/GB. Inbound
is free everywhere, and USSD/SMS/IVR traffic is negligible (small form-encoded
POSTs). The thing that will actually drive this bill is **buyers browsing lot
photos**, which are served off the volume. If egress ever looks alarming, that's
the cause, and a thumbnail size is the fix.

**Snapshot billing is new** — Fly began charging for volume snapshots on
1 January 2026 ($0.08/GB/month, first 10GB free). Guides written before then
omit it. At 3GB you are comfortably inside the free allowance.

### On the region — I was wrong twice

I first justified Johannesburg by USSD latency, on a "few seconds" timeout. The
documented budget is **10 seconds**, which is generous, so that argument is dead.

The second problem is the assumption underneath it. **Geographic proximity is not
network proximity in Africa.** West African submarine cables (WACS, MainOne, SAT-3)
run *north to Europe*, so traffic from Accra to Johannesburg frequently transits
Europe anyway — London can be the faster hop despite being further away. Fly has
exactly one African region (`jnb`), and it is also the more expensive of the two.

**Recommendation: start in `lhr`.** It is ~$3/month cheaper, plausibly faster for
Ghanaian users, and nothing in the product needs an African region. Then measure
from Accra before spending anything to move — this is a claim to test, not to
trust. If jnb measures better, the switch is a one-line change and a redeploy.

### Trimming it

A **reservation block** — $36/year prepaid for $5/month of compute credit — takes
a jnb deployment from $10.27 to ~$8.27/month, saving $24/year. Only worth it once
you are certain of the region, since credits are region-specific and don't roll over.

## 5. AI grading (Hugging Face)

_Checked 24 August 2026 against HF's pricing docs and its live `/v1/models` endpoint._

Hugging Face bills **pass-through** — the provider's rate with no HF markup.

| Account tier | Monthly cost | Included inference credit |
|---|---|---|
| Free | $0 | **$0.10** |
| **PRO** | **$9** | $2.00 |
| Team | $20/user | $2.00/seat |

### What a grading call actually costs

Images are converted to tokens at **one visual token per 32×32 pixel block** —
so a 1024×1024 photo is ~1,026 tokens, and cost scales linearly with pixel count.
This pipeline already resizes to ≤1024px at upload
([`photos.ts:31`](../packages/core/src/domain/photos.ts#L31)), so the numbers are
predictable:

| Per grading call | ~1,200 input + 200 output tokens |
|---|---|
| Via novita (router default) | **$0.00038** |
| Via deepinfra (`:cheapest`) | **$0.00030** |

| Grades/month | Cost |
|---|---|
| 100 | $0.03 |
| 1,000 | **$0.30** |
| 10,000 | $3.00 |

Translation (`gemma-3-27b`) is ~$0.07 per 1,000 calls. Whisper ASR via deepinfra
is $0.00045 per audio-minute — 1,000 thirty-second clips is $0.23.

**Inference is not a cost driver at this scale.** At 1,000 grades a month the
actual compute is about **$0.60 all-in**. The $9 PRO subscription is 15× the
compute it pays for.

### The thing that will actually bite

**The `HF_TOKEN` currently in `.env` is a Free account with billing disabled.**
That means a hard stop at $0.10/month — roughly **300 grading calls** — after
which grading fails rather than overflowing into pay-as-you-go. Fine for
testing; it will fail mid-pilot without warning.

Before real traffic: either upgrade to **PRO ($9/month**, whose $2 credit
absorbs usage up to ~5,000 grades/month) or pre-purchase credits. This is the
one HF decision that matters.

### Two small wins

**Append `:cheapest` to the model id** — `Qwen/Qwen3-VL-30B-A3B-Instruct:cheapest`
routes to DeepInfra instead of Novita: ~21% cheaper and double the context
window, same model. It is a one-word change to `GRADING_MODEL`. Be honest about
the stakes though — it saves about **$0.08/month** at 1,000 grades. Take it for
the context window, not the money.

**Do not shrink the photos further.** Dropping to 768px would cut input tokens
44%, but 44% of $0.30 is not worth risking grading accuracy on mould and
discolouration. The existing 1024px cap is the right call.

## 6. Moving real money

_Checked 24 August 2026 against the Bank of Ghana licensed-PSP register, MTN's
Ghana product terms, and each provider's own documentation._

This is the section with legal weight, and the one where the published numbers
are thinnest — **most Ghanaian processors do not publish pricing at all.**
Everything below is labelled with how well it is sourced.

### Two providers to strike off immediately

**Zeepay — licence revoked.** The Bank of Ghana revoked Zeepay Ghana Ltd's
Dedicated Electronic Money Issuer licence on **14 July 2026**, citing issuance of
electronic money without cash backing. It is absent from BoG's current register.
Do not integrate.

**Slydepay — discontinued 31 May 2023.** Both domains time out. Its published API
never had a payout endpoint. The successor entity is Kowri (SEVN Ghana Ltd, PSP
Enhanced), but Kowri publishes no API docs.

Worth knowing because both still appear in blog posts and in *other providers'*
integration docs — PaySwitch's payout documentation still lists Zeepay as a valid
destination switch.

### Don't integrate MTN directly

MTN publishes Ghana rates — **2% collections, 1% disbursements** — and they are
*worse* than the aggregators, for considerably more friction: MTN wallets only
(no Telecel Cash or AT Money), a **physical MTN SIM handed to MobileMoney Ltd**,
a **pre-funded** disbursement account, two-person authorisation on every payout,
IP whitelisting, a contractual obligation to run a customer helpline, submission
to MTN audit rights, and an **unpublished approval timeline** — one developer
publicly reported four months of waiting after passing UAT.

Direct MTN becomes worth it at volume, when that negotiable 2% is worth
negotiating. Not for a pilot.

### The providers with published pricing

| Provider | Collection | MoMo payout | Settlement | BoG licence |
|---|---|---|---|---|
| **Paystack** | 1.95% | **GHS 1 flat** | T+1 | PSP Enhanced |
| **Moolre** | 1% cap GHS 10 + network 0.5–1% cap GHS 20 | 1%, cap GHS 10 | not published | PSP Enhanced |
| **Hubtel** | 1.95% MTN/Telecel, 2.5% AT | 1% ≤500; GHS 5 (500–1k); GHS 10 (1k–30k) | same day before 5pm | PSP Enhanced |
| **Flutterwave** | 2% (pages conflict) | **1.5% uncapped** | ~24h | PSP Enhanced |
| MTN direct | 2% | 1% | — | MML is a DEMI |

Korba, theTeller/PaySwitch, Nsano, ExpressPay and Kowri publish **nothing** —
all negotiated. **ExpressPay has no payout API at all** (dashboard Excel batches
only), which rules it out for automated farmer payments.

### Caps versus flat fees — and why lot size decides

The two halves of a transaction have **different winners**, and agricultural lots
are large enough that it matters.

**Payouts: Paystack, decisively.** A flat **GHS 1** regardless of amount, against
percentages everywhere else. On a GHS 5,000 farmer payout:

| Paystack | Hubtel | MTN direct | Flutterwave |
|---|---|---|---|
| **GHS 1** | GHS 10 | GHS 50 | GHS 75 |

**Collections: Moolre above ~GHS 1,540**, because its fees cap at ~GHS 30 total
while Paystack's 1.95% runs uncapped.

| Lot value | Paystack (1.95%) | Moolre (capped) |
|---|---|---|
| GHS 500 | **GHS 9.75** | ~GHS 15 |
| GHS 2,000 | **GHS 39** | ~GHS 30 |
| GHS 10,000 | GHS 195 | **~GHS 30** |
| GHS 20,000 | GHS 390 | **~GHS 30** |

So the cheapest published structure for a **large-lot** marketplace is Moolre
collections plus Paystack payouts — at the cost of two integrations and two
floats. For a pilot, **Paystack alone is the right call**: one integration, a
48-hour document review, and the payout side is where it is strongest.

**Keep this in proportion.** `PRODUCT.md` records that no platform fee exists
today, so payment cost is currently the *entire* cost of a transaction — and at
~2% it still dwarfs hosting ($7/month) and AI ($0.60/month) by orders of
magnitude.

### The architectural finding: where payout money comes from

Only **Korba** (Halges Financial Technologies, PSP Enhanced) documents a **single
wallet serving both directions** — collections credit an OVA, disbursements debit
the same OVA. Everyone else — MTN direct, PaySwitch/TheTeller, appsNmobile —
requires a **separately pre-funded payout float**.

That distinction is not a detail; it decides whether this product needs working
capital. With a separate float you must fund farmer payouts from your own money
*before* the buyer's collection settles to you. With a single wallet, escrow
mechanics map onto the rail directly — which is exactly what the ledger already
models. Korba does not publish pricing, but it is worth a conversation on
structure alone.

### 🚩 Bank of Ghana licensing — read this before holding a cedi

**Getting your own licence is not an option at this scale.** BoG's categories
require *integrity capital* deposited in a **blocked account, inaccessible for
the whole five-year licence term**:

| Licence | Blocked capital | Licence fee |
|---|---|---|
| PSP Enhanced | **GHS 2,000,000** | GHS 40,000 |
| PSP Medium | GHS 800,000 | GHS 15,000 |
| PSP Standard | none | GHS 1,000 |

PSP Standard is cheap but useless here: it is reserved for wholly
Ghanaian-owned entities, covers mobile payment apps only, must connect to an
Enhanced PSP, and **does not authorise payment aggregation.**

**The normal route is to ride a licensed PSP.** If funds never enter an account
you control, the PSP pays the farmer on your instruction, and you are
contractually its *merchant* rather than a payment intermediary, then you are
**consuming** a licensed payment service rather than **providing** one, and no
licence is triggered. Every Ghanaian marketplace of this size works this way.

**But the risk lives in exactly what this product does.** What turns a merchant
into an unlicensed payment service provider is **time-in-custody and discretion
over funds** — and F2M's escrow holds buyer money from contract acceptance until
verified pickup, with the platform adjudicating release via grading. That is the
pattern, not an edge case near it. Zeepay's July 2026 revocation is the live
demonstration that BoG enforces this.

Three ways to de-risk, best first:

1. **Split settlement** — funds settle directly to the farmer; you never hold
   them. Structurally dissolves the question. Ask Paystack whether a Ghana
   subaccount can settle to a **MoMo wallet** rather than a bank account; that
   answer shapes the design.
2. **Ride the PSP's own delayed settlement** instead of building a float.
3. **Bank escrow** — pooled buyer funds in a segregated trust account at a
   licensed Ghanaian bank, under a written escrow agreement.

Option 1 is in genuine tension with the current product: consent-first escrow
where "money moves only on the owning party's explicit yes" is the positioning,
and split settlement moves the money before that yes. **That is a product
decision, not a technical one**, and it is worth resolving deliberately rather
than discovering it during compliance review.

BoG publishes **no escrow-specific category and no guidance** on whether
commodity-marketplace escrow is a payment service. Their PSP-Enhanced wording
covers a *"marketplace for financial services"* — an agritech marketplace is not
that, which helps, but it is not clearance.

> **Write to `fintech@bog.gov.gh` describing the exact flow, and take Ghanaian
> regulatory legal advice, before real third-party money moves.** This is the one
> item here where being wrong costs vastly more than the advice.

### E-Levy: abolished — it does not apply

The Electronic Transfer Levy was **repealed by Act 1128, effective 2 April 2025**.
The 1% no longer applies to mobile money, bank transfers or merchant payments.

Two traps: **GRA's own E-Levy FAQ page is stale** and still reads "The rate is
1%", and at least one 2026 blog still asserts it is active. Both are wrong. No
reintroduction has been legislated.

### Getting registered

| Item | Cost |
|---|---|
| Company Limited by Shares (incl. Constitution, Form 3, beneficial ownership) | **GHS 585** |
| Capital duty on stated capital | 1% |
| TIN | free (Ghana Card PIN serves as TIN for individuals) |
| Optional VIP/expedited service | +GHS 1,300 |
| Annual returns, recurring | GHS 175/year |

**~GHS 600–800 all-in**, typically 3–10 business days. Widely-quoted figures of
GHS 450 are stale — ORC's schedule changed on 2 February 2026.

Incorporation is not optional at any real volume: BoG's merchant tiers put any
merchant averaging **above GHS 15,000/month into Tier 3, which must be
incorporated.** And Paystack **only enables transfers for registered
businesses** — a Starter account cannot pay out at all.

### Integration hazard: the Telecel rebrand

Vodafone Ghana became Telecel. **Korba, PaySwitch, appsNmobile and MTN's own docs
still say "Vodafone"** in their network-code tables. Only Moolre and Hubtel name
Telecel correctly. Confirm live network codes with whoever you pick — this is the
kind of thing that fails in production and not in sandbox.

### The ledger has no account for any of this

Worth flagging before real money moves, because the code is otherwise ready.
The journal accounts are `external`, `escrow(contractId)`,
`farmerPayable(farmerId)` and `buyerRefunds(buyerId)`
([`paymentFlow.ts:239-289`](../packages/core/src/domain/paymentFlow.ts#L239-L289)).
A hold moves `external → escrow`; a payout moves `escrow → farmerPayable`; any
remainder returns to the buyer. Escrow zeroes out. The books balance.

**There is no processor-fee account anywhere.**

On mock rails that is invisible and harmless. On real rails, MTN takes its 2% off
the collections account, so `holdAmount × 0.98` actually arrives while the ledger
records `holdAmount` — and 1% comes off the disbursement, so the farmer receives
`finalAmount × 0.99` while the ledger records `finalAmount`. The journals stay
internally balanced and every existing test keeps passing, while the ledger
drifts steadily out of agreement with the actual MoMo balance.

That is the reconciliation break that `PRODUCT.md`'s "money stays boring"
principle exists to prevent, and it would pass its own invariants the whole way
down. It needs a decision before any real settlement:

1. **Who absorbs the fee** — the buyer (funds `holdAmount + fee`), the farmer
   (receives `finalAmount − fee`), or the platform (eats it)? This is a product
   and fairness question, not a technical one, and it is sharper given
   `PRODUCT.md` records that no platform fee exists today.
2. **Add a fee account** so journals reflect what the rail actually did.

Nothing needs changing while `PAYMENT_PROVIDER=mock`. It should not go live
without it.

### Farmer wallet limits will fail large payouts

A minimum-KYC MoMo wallet is capped at roughly **GHS 3,000/day with a GHS 5,000
maximum balance**; medium KYC lifts that to GHS 15,000/day and GHS 40,000
balance. A good harvest exceeds those. **Large payouts will simply fail**, and
the payout logic has no tier-checking or payment-splitting today.

Worth building before the pilot, and worth pushing farmers to upgrade KYC at
registration. (Limits are consistent across sources but were not verified
against a primary BoG notice — confirm.)

### The cheapest legitimate path

| | Cost |
|---|---|
| Company registration + TIN | **~GHS 600–800** one-off, GHS 175/year after |
| BoG licence | **GHS 0** — riding a licensed PSP |
| PSP setup | **GHS 0** |
| Collection | 1.95% |
| Farmer payout | **GHS 1 flat** |
| E-Levy | **GHS 0 — abolished** |

**A GHS 1,000 buyer→farmer transaction costs about GHS 20.50 all-in**, and under
GHS 1,000 of setup gets you legally moving real money.

Sequence, with the slow things started first:

1. **Register the company and get the TIN.** Nothing else can proceed without it,
   and it gates Paystack transfers.
2. **Same day, email `fintech@bog.gov.gh`** describing the escrow flow, and brief
   a Ghanaian regulatory lawyer. Runs in parallel; don't let go-live outrun it.
3. **Apply to Paystack as a Registered Business** (~48h review). Immediately
   email `support@paystack.com` to request manual payouts / settle-to-balance —
   it is **not self-serve**, and they weigh transaction history a new account
   doesn't have. Ask in the same message whether a Ghana subaccount can settle to
   a MoMo wallet.
4. **Hedge with Hubtel**, but email `compliance@hubtel.com` first: their KYC
   policy says the business must be *"the direct provider of the product or
   service (No agents)"*, and a farmer-buyer marketplace is structurally an
   intermediary.

### Still open

- **Whether BoG treats commodity-marketplace escrow as a licensable payment
  service.** No published guidance exists. Highest-stakes gap in this document.
- Whether a Paystack Ghana subaccount can settle to a MoMo wallet — decides
  whether split settlement is even available.
- Which of Flutterwave's two contradictory official Ghana pricing pages governs.
- Whether a marketplace clears Hubtel's "No agents" rule.
- Onboarding turnaround: **not one provider publishes an SLA.** Ask, and get it
  in writing.

Until the first of these is answered, `PAYMENT_PROVIDER=mock` is the correct
setting. The ledger balances identically, so nothing is blocked by waiting.

## 7. Local language (Khaya AI / GhanaNLP)

Khaya keys are free and quota-metered (`KHAYA_API_KEY`, D-038/D-041), and this
pilot runs English-only regardless — the D-040 review gate resolves unreviewed
locales to English on every farmer-facing surface. **No cost until language day.**
