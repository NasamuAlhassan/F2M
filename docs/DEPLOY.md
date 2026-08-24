# Deploy

The pilot runs as **one container on Fly.io** serving one origin: the portal,
the REST API, and the Africa's Talking USSD/Voice webhooks. One HTTPS URL for
everything — AT callbacks, QR trace links, and IVR audio all resolve against it.

## Why not serverless

Vercel and friends were ruled out on three specific grounds, all structural:

1. **USSD sessions are rows in SQLite on disk.** Africa's Talking posts every
   keypress as a separate HTTP request. On serverless, consecutive keypresses
   land on different instances with different ephemeral filesystems, so the
   menu breaks at the second screen.
2. **The sweeps are `setInterval` timers** (`apps/server/src/jobs/sweep.ts`) —
   a 60s lane and a 5s lane that deliver SMS, place outbound voice calls, poll
   payment status, expire offers, and refund missed pickups. Functions that
   sleep between requests never run any of it.
3. **Photos and cached TTS audio are written to disk** and served back by URL —
   the IVR hands AT a `PUBLIC_BASE_URL/tts/….mp3` to play. Ephemeral storage
   means AT fetches a 404.

The same three reasons are why `fly.toml` sets `auto_stop_machines = false`
and `min_machines_running = 1`. A machine that sleeps when idle silently stops
being a working product.

**One machine only.** SQLite lives on a single attached volume; scaling to two
machines would give each its own volume and silently fork the pilot's data.

## Prerequisites

- **Node 24+** locally (`.nvmrc` pins 24) — for `npm test` and `npm run demo`.
- **flyctl** — `curl -L https://fly.io/install.sh | sh`, then `fly auth signup`.
- Docker is *not* required; Fly builds the image remotely.

## First deploy — everything mocked

The first deploy's only job is to prove the container, the volume, migrations
and the portal. `fly.toml` ships every provider set to `mock` for exactly that
reason: nothing external can muddy the result, and nothing can fail the boot.

```bash
fly launch --no-deploy          # claims the app name, keeps this fly.toml
fly volumes create ftm_data --size 3 --region jnb
fly platform regions            # confirm jnb exists; lhr (London) is the fallback

fly secrets set JWT_SECRET="$(openssl rand -hex 32)"
fly deploy
fly secrets set PUBLIC_BASE_URL="https://<your-app>.fly.dev"
```

`PUBLIC_BASE_URL` is a chicken-and-egg step — the hostname only exists after the
first deploy. It is not cosmetic: it builds the QR trace links, the IVR `<Play>`
audio URLs and the voice answer callbacks (`packages/core/src/domain/voiceCalls.ts`,
`apps/server/src/routes/voice.ts`). Wrong value = silent breakage in exactly the
flows you are trying to test.

### Seed the registries

Migrations run automatically on boot (`apps/server/src/index.ts`), but they only
create tables. The registries — regions, commodities, units, grading rubrics,
the vehicle rate card, reference market prices — come from the seed, and without
them there is nothing to list or grade:

```bash
fly ssh console -C "npm run db:seed -w @ftm/core"
```

The seed is idempotent and creates **no** fake farmers, lots, or contracts. It
does create one demo buyer, `buyer@demo.ftm`.

> **Change or remove that account before real users touch this.** Its password
> is hardcoded in `packages/core/src/db/seed.ts` and is now on the public
> internet. It is a demo credential, not a pilot credential.

### Verify

```bash
curl https://<your-app>.fly.dev/health          # {"ok":true}
curl https://<your-app>.fly.dev/api/registries  # commodities present = seed worked
fly logs                                        # sweep lines confirm the timers are alive
```

Then open the portal at the same URL, and the simulators at `/ussd-tester.html`
and `/ivr-tester.html` — they ship in the image alongside the built portal.

---

## What "testing USSD and IVR for real" actually costs

Researched against Africa's Talking' own docs and Ghana rate cards, August 2026.
The headline: **USSD is free to test today, IVR is not free at all.**

### USSD — free in the sandbox, but simulator only

AT's sandbox is fully usable at no cost, and the callback URL points at this
deployment. But sandbox USSD **cannot be dialled from a real handset, ever**:

> "The interactions with these resources occur in the SIMULATOR:
> https://simulator.africastalking.com:1517/ and NOT the HANDSET for all
> development and tests on the sandbox."

So the sandbox proves the flow end to end against real AT wire formats — which
is genuinely valuable — but a Nokia in Accra dialling a real shortcode needs a
live code. Ghana pricing:

| | Shared code | Dedicated code (all three telcos) |
|---|---|---|
| Setup | **Free** | ~GHS 11,500 one-off + annual regulator fee |
| Monthly | **GHS 900** | ~GHS 11,000 |
| Deposit | USD 100 | USD 100 |
| Lead time | **~2 working days** | weeks (AT publishes no Ghana figure) |

**Start with a shared code.** It is roughly 12× cheaper, has no setup fee, and
provisions in two days. Contact `ussd@africastalking.com`.

### IVR — there is no free path

This is the finding that most affects the plan. AT's voice sandbox is
**officially non-operational** (their own article, February 2026):

> "For Voice, the sandbox is not operational."

To hear the IVR on a real phone you need a **live** app and a real Ghana voice
number — requested via `Voice → Phone number → … → Category: "Test Number"`.

| Ghana voice number | Cost |
|---|---|
| Setup (one-off) | GHS 500 + 15% VAT |
| Monthly | GHS 300 + 15% VAT |
| Incoming | GHS 0.009/min |
| Outgoing | GHS 0.20/min |

Pick a **Regular** number: Toll-Free, Premium and Virtualized numbers cannot
originate outbound calls, and this product places outbound offer calls.
Contact `voice@africastalking.com`.

### SMS — free to enable, but blocked until approved

Ghana has **no default sender ID fallback** (unlike Kenya):

> "you can send test SMSes with the default Africa's Talking sender ID only in
> Kenya … For other regions or networks, please apply for a sender ID"

Registering one is **free** — max 11 characters, plus a company website link and
a sample message — but until it is approved, `NOTIFY_PROVIDER=at` will send
nothing. Ghana SMS costs GHS 0.038–0.050 per message. AT publishes no approval
SLA, so **apply early**; it gates every SMS receipt in the product.

---

## Flipping providers on

One at a time, verifying between each. Edit `fly.toml`, then `fly deploy`.
`config.ts` fails fast at boot with the exact missing key, so a wrong order is
loud rather than silent.

```bash
# 1. AI grading — free, needs only a token
fly secrets set HF_TOKEN="hf_…"
#    then set GRADING_PROVIDER = "hf" in fly.toml, fly deploy

# 2. SMS — needs an APPROVED Ghana sender ID or nothing sends
fly secrets set AT_API_KEY="atsk_…" AT_USERNAME="your-username" \
                USSD_SHORTCODE="*384*…#"
#    then set NOTIFY_PROVIDER = "at" in fly.toml, fly deploy

# 3. Voice — needs a PAID live Ghana number
fly secrets set AT_VOICE_NUMBER="+233…"
#    then set VOICE_PROVIDER = "at" in fly.toml, fly deploy
```

Payments stay `mock` — MoMo needs business registration, and the double-entry
ledger balances identically either way; only the rail behind it changes.

## Wire the callbacks

Point AT at the deployed hostname. Routes come from the code:

| AT setting | Where in the dashboard | URL |
|---|---|---|
| USSD callback | USSD → Service Codes → ⋮ → Callback | `https://<app>.fly.dev/ussd` |
| USSD events | same dialog, Events URL | `https://<app>.fly.dev/ussd` |
| Voice callback | Voice → Phone Numbers → Actions → Callback | `https://<app>.fly.dev/voice/answer` |
| Voice events | same | `https://<app>.fly.dev/voice/events` |

Note the asymmetry: USSD callbacks hang off the **service code**, voice
callbacks off the **phone number**.

HTTPS is not required by AT (plain HTTP works) but Fly gives it by default.

### Two constraints worth designing around

**A USSD callback must answer within 10 seconds.** Today's handlers are
SQLite-only and finish in milliseconds — with one exception: accepting an offer
over USSD calls `acceptOfferAndHold`, which awaits the payment provider inline
(`paymentFlow.ts:328`). Harmless on the mock. When MoMo goes live, that path
puts an MTN API round-trip inside AT's 10-second budget and should move to the
sweep before real money rides on it.

**There is no webhook signature scheme.** AT offers no HMAC and publishes no
egress IP list — their own guidance is a secret URL path plus HTTPS. As it
stands, `/ussd` and `/voice/answer` are unauthenticated public endpoints, so
anyone who finds the hostname can drive USSD sessions and register farmers.
Before real users, move these behind an unguessable path segment.

## Language

Nothing to configure. `I18N_DRAFT_LOCALES_LIVE=false` is the default, and the
D-040 review gate resolves every unreviewed locale to English on SMS, USSD and
IVR. The pilot is English-only until a native speaker signs a catalog off.
