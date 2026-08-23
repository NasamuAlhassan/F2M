# Build log

Chronological record of what was built, changed, or edited, and why. One section per milestone; significant mid-milestone changes get their own dated entries. Newest at the bottom.

---

## 2026-08-23 · M0 started — scaffold

- `git init`, monorepo directory tree, root `package.json` (npm workspaces: `packages/core`, `apps/server`, `apps/web`), strict `tsconfig.base.json`, `.gitattributes` (LF everywhere — Windows dev, avoids CRLF churn), `.nvmrc` pinning Node 24 (prebuilds cover better-sqlite3 and sharp, so no native build toolchain needed).
- `.env.example` documenting every key; mock mode deliberately needs zero keys (see D-013).
- `docs/` created: PROJECT.md (vision + MVP definition), DECISIONS.md (seeded D-001…D-015 with everything settled during planning), this file.

## 2026-08-23 · M0 complete — schema, migrations, seed, smoke tests

- `@ftm/core` package: Zod-validated env loader (`config.ts` — boot fails listing exactly the keys missing for the providers selected; mock mode needs none), full Drizzle SQLite schema (16 tables: farmers, buyers, commodities, units, rubrics, lots, demands, matches, contracts, gradings, photos, payments, ledger_entries, lot_events, ussd_sessions, regions), generated SQL migration checked in (`drizzle/0000_*.sql`).
- Domain JSON types behind Zod (`domain/types.ts`): ClockConfig, RubricDoc, PriceTerms (integer pesewas — D-011), score breakdown, grading reasons, `expandPriceTerms` band multipliers.
- i18n layer (`i18n/`): flat `en.json` catalog + `t(locale, key, params)` with English → key fallback; all seed data references `name_key`s, no display strings in the DB (D-012).
- Seed: 16 Ghana regions with centroids (distance fallback for GPS-less farmers), MAIZE/TOMATO/YAM with clock configs (24h/2h/12h offer TTLs), commodity-scoped units incl. informal olonka + basket, full v1 grading rubrics (4–5 criteria each with visual cues + band descriptors), demo buyer.
- Vitest wired at the root (single worker — DB-backed suites serialize); 4 schema/seed smoke tests green.
- **Deviations from plan:** npm resolved newer majors than planned — TypeScript 7, Zod 4, Vitest 4, better-sqlite3 13 — all kept (better-sqlite3 13 ships Windows prebuilds in the tarball; the node-gyp warning during install is a harmless fallback attempt). Zod 4 API used (`code: 'custom'`, exhaustive enum-key records).

## 2026-08-23 · M1 complete — core domain services + REST API

- Domain services in `@ftm/core/domain` (the single implementation both USSD and web adapt over — the feature-parity rule): `farmers.ts` (Ghanaian phone normalization to E.164, registration), `lots.ts` (unit→kg conversion at intake, clock-enforced ready dates — perishables can't forward-list beyond tomorrow, lot codes from an unambiguous alphabet, LOT_REGISTERED trace event in the same transaction), `demands.ts` (window validated against the commodity clock's maxWindowDays, base price expanded to a per-band schedule or explicit priceTerms accepted), `registries.ts`, `buyers.ts`, `trace.ts` (append-only, per-lot monotonic seq, transaction-scoped).
- `DomainError` with stable codes: surfaces map them (REST → HTTP status now; USSD → error line in M2).
- Fastify server (`apps/server`): JWT buyer auth, error handler mapping DomainError/ZodError, routes for auth, registries, farmers, lots (+trace), demands. `runMigrations()` on boot so a fresh checkout needs no manual db step.
- Verified: 17 vitest tests green (unit conversions incl. olonka→kg, phone normalization, price expansion, full API flow: login → farmer → olonka lot → trace shows LOT_REGISTERED → authed demand; clock rejections for perishable forward listing and over-long tomato windows). Live server smoke-tested with Invoke-RestMethod.
