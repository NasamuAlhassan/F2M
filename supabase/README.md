# Supabase setup

Supabase handles **logins only**: phone number + password, for farmers,
buyers and drivers alike. Everything else about a person (their role, region,
listings, offers and money) lives in F2M's own server database. The server
checks each Supabase login and links it to that person's F2M record.

Until an SMS sender ID is approved for Ghana, no confirmation code can be
texted, so signup is **invite-only**: only phone numbers you have added can
create an account.

## 1. Run the SQL

Dashboard → **SQL Editor** → paste the contents of
[`migrations/0001_invite_only_signup.sql`](migrations/0001_invite_only_signup.sql)
→ **Run**. It is safe to run more than once. It creates:

- `signup_invites`, the list of phone numbers allowed to sign up. The browser
  can't read or change it, only the auth server and you can.
- `hook_invite_only_signup`, the check Supabase runs before creating any
  account.

It also removes the earlier `profiles` design if it was ever run, because that
design's signup trigger would reject phone signups.

## 2. Turn the check on

Dashboard → **Authentication → Hooks** → **Before User Created** → choose
**Postgres** → schema `public` → function `hook_invite_only_signup` → enable
and save.

## 3. Turn on phone + password sign-in

Dashboard → **Authentication → Sign In / Providers → Phone**:

- **Enable phone provider**: on.
- **Confirm phone**: off, until the SMS sender ID is approved. With it on,
  every signup waits for a text that cannot arrive yet.

If the dashboard refuses to save without SMS provider details (Twilio and so
on), leave it and say so. A Send SMS Hook routed through Africa's Talking
replaces that field.

## 4. Invite your numbers

In the SQL Editor:

```sql
insert into public.signup_invites (phone, note) values
  ('233XXXXXXXXX', 'me — farmer'),
  ('233XXXXXXXXX', 'me — buyer'),
  ('233XXXXXXXXX', 'friend — driver')
on conflict (phone) do nothing;
```

Write numbers as `233` followed by 9 digits, with no plus and no spaces. One
role per phone number, the same rule USSD uses.

## Keys

`.env` at the repo root needs the **Project URL** and the **publishable** (or
legacy anon) key:

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable or anon key>
```

Never put the `service_role` / secret key in this project. Nothing in F2M
needs it, and it bypasses every protection above.

## Later, when SMS works

Once the sender ID is approved, turn **Confirm phone** back on and connect
SMS through a Send SMS Hook to Africa's Talking. The invite list can then be
opened up or removed.
