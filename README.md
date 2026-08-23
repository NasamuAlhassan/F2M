# Farm to Market

**A national marketplace connecting Ghanaian farmers to verified buyers, built so a farmer with a basic phone can use every part of it.**

One transaction spine — **register → match → contract → grade → pay → trace** — with every surface at feature parity: **USSD** for farmers and drivers (works on a Nokia 105), **outbound voice calls** (hear the offer, press 1 to accept), and a **web portal** for buyers and drivers, in a flat sunlight-readable "paper terminal" design. Commodity-agnostic via three registries (rubrics, units incl. olonka, per-commodity clocks), with a **driver & logistics layer** (rate-card quotes, nearest-first dispatch, transport escrow released on verified delivery) riding the same double-entry ledger.

Read the full vision, MVP definition, and status in [`docs/PROJECT.md`](docs/PROJECT.md). Every architectural choice is logged with reasons in [`docs/DECISIONS.md`](docs/DECISIONS.md); everything built and changed is in [`docs/BUILDLOG.md`](docs/BUILDLOG.md).

## Quickstart

Requires Node 24+ (prebuilt binaries for better-sqlite3/sharp — no compiler toolchain).

```
npm install
npm run db:reset        # migrate + seed (prints the demo buyer login)
npm run demo            # one lot end to end, fully offline: voice accept + transport leg included
npm run dev             # server :3000 + portal :5173
npm test                # 106 tests: scorers, state machines, ledger invariants, USSD/IVR wire walks
```

Then follow [`DEMO.md`](DEMO.md) for the three-tab demo: the USSD tester and the ringing IVR tester (`localhost:3000/ussd-tester.html`, `/ivr-tester.html`) as the farmer/driver phones, the portal (`localhost:5173`) as the buyer.

## Layout

```
packages/core       All domain logic: schema, contract + delivery-job state
                    machines, matching, dispatch, ledger, notifications, and the
                    payment/grading/SMS/voice providers. USSD, IVR, and web are
                    all thin adapters over these services — the feature-parity rule.
apps/server         Fastify: REST API, USSD webhook + IVR voice wire (Africa's
                    Talking formats), MoMo callbacks, sweep jobs, tester pages,
                    demo script.
apps/web            Vite + React portal (buyer + driver roles), paper-terminal design.
docs/               PROJECT.md · DECISIONS.md · BUILDLOG.md — the living record.
```

## Real providers

Mock mode needs zero keys. To go real, copy `.env.example` → `.env` and fill in:

| Layer | Provider | Setup |
|---|---|---|
| AI grading | HuggingFace router (free vision models) | `HF_TOKEN` + `GRADING_PROVIDER=hf` |
| Payments | MTN MoMo sandbox (Collections + Disbursements) | subscribe to both products, `npm run momo:provision`, `PAYMENT_PROVIDER=momo` |
| USSD | Africa's Talking sandbox | service code + ngrok, callback → `/ussd` |
| SMS | Africa's Talking | `AT_API_KEY` + `NOTIFY_PROVIDER=at` |
| Voice/IVR | Africa's Talking Voice | `AT_API_KEY` + `AT_VOICE_NUMBER` + `VOICE_PROVIDER=at` |

Every external boundary has a deterministic mock behind the same interface, so nothing here blocks on an account (see D-013 in the decision log).
