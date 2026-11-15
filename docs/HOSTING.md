# Hosting on Vercel + Supabase, at $0

The owner chose this over a paid server (2026-11-14): no money for Render, so
F2M runs on free plans. Two Vercel projects hold the code; Supabase holds
everything that must last.

| Need | Where |
|---|---|
| Web portal | Vercel project **f2m-web**: root `apps/web`, Vite |
| API, USSD and voice callbacks | Vercel project **f2m-server**: root `apps/server`, Fastify as a function |
| Database | **Supabase Postgres**, schema `f2m` (kept out of Supabase's public REST API), through the transaction pooler |
| Photos, recordings, voice clips | **Supabase Storage**, public bucket `media` (written only with the server's service key) |
| The sweep (offer expiry, calls, payments, SMS, the 24 h receipt clock…) | **Supabase `pg_cron` + `pg_net`**, calling `POST /api/cron/sweep` every minute (and the fast lane every 20 s) with a secret |
| Logins | Supabase Auth (unchanged) |
| Live screen updates | the web polls (serverless instances share no memory) |

The browser only ever talks to **f2m-web**. Its `vercel.json` passes `/api`, `/ussd`,
`/voice`, `/health` and the tester pages through to f2m-server, so there is one
origin and no cross-origin setup.

Locally nothing changes: `npm run dev` uses **PGlite**, a real Postgres running
in-process, with its data in `data/pglite`. Files go on disk and the sweep runs on
timers. Tests use an in-memory PGlite. No Docker, no cloud account.

## How the code fits serverless

- **Every database call is async** (Postgres). While a transaction is open, `db`
  is that transaction (`db/client.ts`), so helpers called inside one stay inside it.
- **Registries** (regions, crops, units, rubrics) are cached in memory per
  instance (`loadRegistries()`), so crop names cost no round trip.
- **Cold starts don't migrate or seed.** The server's build runs `vercel-build`,
  which migrates and adds missing reference data. A cold start loads only the registry cache.
- **Nothing important is kept in memory between requests.** The price-feed clock
  is in the `settings` table, and a recording being heard in the background is
  saved there for whichever instance the "one moment" redirect reaches, kept
  alive by `waitUntil`.

## Deploy, step by step

**1. Supabase** (the project you already use for logins):
- Settings → API: copy the **service_role** key. It's secret; you'll paste it into
  Vercel only, never into the web project or the repo.
- Connect → **Transaction pooler**: copy the URI (port **6543**) and put your
  database password in it. That's `DATABASE_URL`.

**2. Vercel: the server first** (New Project → import `NasamuAlhassan/F2M`):
- Root Directory: **`apps/server`**. Framework: **Fastify** (it should detect it).
- Environment variables:

  | Name | Value |
  |---|---|
  | `DATABASE_URL` | the transaction pooler URI from step 1 |
  | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
  | `SUPABASE_SERVICE_ROLE_KEY` | the service_role key |
  | `STORAGE_PROVIDER` | `supabase` |
  | `CRON_SECRET` | a long random string (32+ characters) |
  | `CARRIER_WEBHOOK_TOKEN` | another long random string |
  | `I18N_DRAFT_LOCALES_LIVE` | `true` |
  | `PUBLIC_BASE_URL` | leave for now; set in step 4 |

- Deploy. The build creates the tables and reference data. Note the URL, e.g.
  `https://f2m-server.vercel.app`. Check `https://f2m-server.vercel.app/health`.

**3. Point the web at it.** Replace every `REPLACE-WITH-YOUR-SERVER.vercel.app` in
`apps/web/vercel.json` with the server's address, then commit and push.

**4. Vercel: the web** (New Project → import the same repo again):
- Root Directory: **`apps/web`** (Vite). **Don't** accept "Services".
- Environment variables: only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Deploy, then set the server's `PUBLIC_BASE_URL` to the **web** address
  (e.g. `https://f2m.vercel.app`) and redeploy the server. Callbacks, QR codes
  and clip URLs are built from it.

**5. Supabase SQL editor:** paste `supabase/migrations/0003_media_and_sweep.sql`,
put in the server's sweep address and your `CRON_SECRET`, and run it. It creates
the `media` bucket and the two scheduled jobs.

**Check:** the web address loads, `/api/registries` lists 13 crops, and after a
minute `select * from net._http_response order by created desc limit 3;` in
Supabase shows `200` answers from the sweep.

## Limits to know

- Vercel's Hobby plan is for **personal, non-commercial** use: fine for the
  prototype and a pilot. Real trading needs Vercel Pro.
- Supabase Free: 500 MB database, 1 GB files, 5 GB transfer a month. A project
  with no database activity for 7 days pauses; the every-minute sweep keeps it active.
- Functions on Hobby run up to 300 s; nothing in F2M runs that long.
- Live updates arrive by polling (every 20–60 s) rather than instantly.
