# Running a live demo

The whole system on several devices, with the carrier (Africa's Talking) simulated
and everything else real: the hosted website and server, the database, speech and
translation through the Tekyerema language Space, photo grading, and the AI assist.

## Who holds what

Each phone number holds **one role**, the same on the website and on the phone
(D-021). Give every person in the demo their own number.

| Person | Device | Opens | Number |
|---|---|---|---|
| Farmer 1 (basic phone) | laptop or phone browser | `farm-2-market.vercel.app/phone?as=farmer` | `+233201234567` (the simulator's default) |
| Farmer 2 (basic phone) | another browser | `/phone?as=farmer`, then change the SIM number | `+233201234568` |
| Driver (basic phone) | another browser | `/phone?as=driver` | `+233541234567` (the default) |
| Buyer(s) | any browser | `farm-2-market.vercel.app/login` → Buyer | your own real numbers |
| Driver or farmer with a smartphone | any browser | `/login` → Driver or Farmer | a number not used above |

The simulator remembers its SIM number per browser, so each device keeps its own.
Any number works; nothing is texted to it. The two testers,
`/ussd-tester.html` and `/ivr-tester.html`, show the raw carrier traffic if you
want to explain what a real phone would see.

## Before you start (10 minutes ahead)

1. **Wake the language Space.** Open `/phone?as=farmer`, tap **Speak a listing**,
   and say one short sentence. The first call in each language loads a model and
   can take a while; after that it answers in a second or two.
2. **Use Chrome or Edge**, and allow the microphone when asked.
3. Sign every web account in once, so nobody types passwords on camera.

## A full run

1. **Farmer lists** on the basic phone: dial the menu (choose a language, register,
   then list), or **Speak a listing** in one breath ("I have ten bags of maize,
   ready next week"). The phone reads the listing back; press **1** to publish.
2. **Buyer finds it**: Market on the website, then make an offer. Or post a
   request under Orders and let the matching alert farmers.
3. **Farmer answers** on the phone: the offer arrives as an SMS and a call in the
   simulator's Messages; accept on the keypad.
4. **A driver takes the job**: on the basic phone (SMS and menu) or on the
   website's Jobs page. Pickup pays the farmer the **30% advance**.
5. **Delivery**: the driver marks it delivered; the buyer confirms receipt on the
   deal page (the rest is paid), or files a claim.
6. Follow it all on the **deal page** (`/deals/...`), which every party sees.

Background work (offer expiry, messages, payment checks) runs every 20–60
seconds, and pages refresh on their own, so allow a moment between steps.

**Shortcuts only the simulator has** (no button yet; ask Claude to run them):
skipping ahead in time, for example past the 24-hour receipt window
(`POST /api/dev/sweep` with a later `now`), and settling a claim, which is the
reviewer's job in Phase 4 (`POST /api/dev/claims/:id/resolve`).

## What is real and what is simulated

| Part | In the demo |
|---|---|
| Website, server, database, logins | real (Vercel + Supabase) |
| Speech recognition, translation, spoken prompts | real: the Tekyerema Space. English is the strongest; the other languages work and improve as the models are fine-tuned |
| Photo grading | real: an open vision model on Hugging Face |
| AI assist (filling gaps in a spoken listing, reading a buyer's request) | real: an open model on Groq |
| SMS and calls | simulated: they appear in the phone simulator, not on real phones |
| Payments (mobile money) | simulated: the ledger is real, no money moves |

When Africa's Talking is paid for, the carrier part becomes real by setting
`NOTIFY_PROVIDER=at`, `VOICE_PROVIDER=at`, the AT keys and a shortcode on the
server, and pointing AT's callbacks at the server. Nothing else changes.

## If something goes wrong

Note the time and what was pressed. The server's logs (Vercel, project
f2m-server, Logs) show every request, and Claude can read them.
