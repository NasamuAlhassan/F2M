# Farm to Market

**A national marketplace connecting Ghanaian farmers to verified buyers, built so a farmer with a basic phone can use every part of it.**

One transaction spine — **register → match → contract → grade → pay → trace** — with two surfaces at feature parity: **USSD** for farmers (works on a Nokia 105) and a **web portal** for buyers. Commodity-agnostic via three registries: a grading rubric, a unit registry (canonical kg, local units like olonka displayed), and a per-commodity clock (storables take forward contracts; perishables route same-day/next-day).

Read the full vision, MVP definition, and status in [`docs/PROJECT.md`](docs/PROJECT.md). Every architectural choice is logged with reasons in [`docs/DECISIONS.md`](docs/DECISIONS.md); everything built and changed is in [`docs/BUILDLOG.md`](docs/BUILDLOG.md).

## Quickstart

Requires Node 24+ (prebuilt binaries for better-sqlite3/sharp — no compiler toolchain).

```
npm install
npm run db:reset        # migrate + seed (prints the demo buyer login)
npm run demo            # one lot, end to end, fully offline — exits 0 on SETTLED
npm run dev             # server :3000 + buyer portal :5173
npm test                # 46 tests: scorer, state machine, ledger invariants, USSD walks, grading
```

Then follow [`DEMO.md`](DEMO.md) for the two-tab demo: the USSD tester (`localhost:3000/ussd-tester.html`) as the farmer, the portal (`localhost:5173`) as the buyer.

## Layout

```
packages/core       All domain logic: schema, state machine, matching, ledger,
                    payment + grading providers, i18n. USSD and web are both
                    thin adapters over these services — that's the feature-parity rule.
apps/server         Fastify: REST API, USSD webhook (Africa's Talking format),
                    MoMo callbacks, photo serving, sweep jobs, demo script.
apps/web            Vite + React buyer portal.
docs/               PROJECT.md · DECISIONS.md · BUILDLOG.md — the living record.
```

## Real providers

Mock mode needs zero keys. To go real, copy `.env.example` → `.env` and fill in:

| Layer | Provider | Setup |
|---|---|---|
| AI grading | HuggingFace router (free vision models) | `HF_TOKEN` + `GRADING_PROVIDER=hf` |
| Payments | MTN MoMo sandbox (Collections + Disbursements) | subscribe to both products, `npm run momo:provision`, `PAYMENT_PROVIDER=momo` |
| USSD | Africa's Talking sandbox | service code + ngrok, callback → `/ussd` |

Every external boundary has a deterministic mock behind the same interface, so nothing here blocks on an account (see D-013 in the decision log).
