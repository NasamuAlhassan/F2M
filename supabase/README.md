# Supabase setup

This is the new unified auth system (role-picker signup: buyer / seller /
driver) — a separate identity system from the existing SQLite
`buyers`/`farmers`/`drivers` tables in `packages/core`. See the note in the
plan this shipped from for why, and the decision still pending on how the
two get reconciled.

## 1. Create the project

[supabase.com/dashboard](https://supabase.com/dashboard) → New project. Pick
a region close to your users — Ghana has no Supabase region, so `eu-west-1`
(London) or wherever your provider's nearest edge is will do; this is a
choice to revisit once real usage tells you which way is faster.

## 2. Run the migration

Dashboard → SQL Editor → paste the contents of
[`migrations/0001_profiles.sql`](migrations/0001_profiles.sql) → Run.

This creates:
- `profiles` — one row per person, holding the role they signed up as and
  the fields specific to it.
- A trigger that creates the profile automatically the moment someone signs
  up, reading the metadata the client sends.
- Row-level security so a profile is only ever readable/writable by the
  person it belongs to.
- A **private** `driver-licenses` storage bucket, with policies so a driver
  can upload and read only their own license photo — nobody else's, not even
  another driver's.

Nothing here needs to be run again unless the schema changes — future
changes should be a new numbered migration file (`0002_...sql`), not an edit
to this one, so the migration history stays honest.

## 3. Get your keys

Dashboard → Project Settings → API. You need two values:

- **Project URL** — `https://<project-ref>.supabase.co`
- **anon / public key** — safe to expose in the browser; RLS is what
  actually protects the data, not keeping this key secret.

**Do not use the `service_role` key here.** That key bypasses row-level
security entirely — it belongs on a trusted server, never in browser code.
Nothing in this phase needs it.

## 4. Wire it into the app

One `.env` for the whole project, at the repo root — same file
`apps/server/src/config.ts` already reads (`vite.config.ts` points Vite's
`envDir` there too, so there's no second `apps/web/.env` to keep in sync).
Copy `.env.example` to `.env` at the repo root and fill in:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<the anon key>
```

Then `npm run dev -w @ftm/web` and visit `/auth`. Signing up as each of the
three roles should land you on the matching dashboard shell
(`/app/buyer`, `/app/seller`, `/app/driver`), and a driver's dashboard
should honestly read "Pending review" — nothing here fabricates a verified
badge.

## 5. Confirm the RLS policies actually hold

Worth doing once, by hand, before trusting this: sign up as two different
people, open the Supabase dashboard's Table Editor as the `service_role`
(which correctly bypasses RLS — that's the dashboard's job) and confirm both
rows exist, then in the app itself confirm neither account can read the
other's profile or license photo. If you can see the second signup's data
while logged in as the first, a policy is wrong — stop and fix it before
this touches anything real, since a driver's license photo is the kind of
data that has to stay private.

## What this doesn't do yet

- Nothing here talks to `apps/server` or `packages/core` — a Supabase
  signup can authenticate but can't yet list a lot, place a bid, or accept
  a delivery job. Those still run on the old SQLite-backed identity system.
  Reconciling the two is a real decision, not done here.
- No real driver-license verification — `verification_status` starts and
  stays `pending` until someone (a person, for now) changes it by hand in
  the Table Editor. Automated verification is a future provider seam, not
  built yet.
