-- F2M · Supabase setup: invite-only phone signup.
--
-- Supabase handles LOGINS only (phone + password). Everything else about a
-- person — farmer, buyer or driver, their region, listings, money — lives in
-- F2M's own server database, so there are no profile tables here.
--
-- Until an SMS sender ID is approved for Ghana, Supabase cannot text a
-- confirmation code, so it cannot prove a phone number belongs to the person
-- signing up. This file closes that gap: only numbers listed in
-- public.signup_invites can create an account. Safe to run more than once.
--
-- Run it in: Dashboard → SQL Editor → paste → Run. Then do the three
-- dashboard steps in supabase/README.md (enable the hook, phone sign-in, and
-- add your numbers).

-- ── 1. Remove the earlier profiles design, if it was ever run ─────────────
-- Its signup trigger rejects any signup without a role in the metadata, so
-- it must not stay. Nothing below fails if these objects never existed.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.profiles;
drop function if exists public.set_driver_verification_default();
drop type if exists public.app_role;
drop type if exists public.verification_status;
drop policy if exists "drivers can upload their own license photo" on storage.objects;
drop policy if exists "drivers can read their own license photo" on storage.objects;

-- ── 2. The invite list ─────────────────────────────────────────────────────
-- One row per phone number allowed to sign up, written the way Supabase
-- stores phones: country code and digits, no plus, no spaces (233XXXXXXXXX).
create table if not exists public.signup_invites (
  phone text primary key check (phone ~ '^233[0-9]{9}$'),
  note text,
  created_at timestamptz not null default now()
);

-- Row-level security with NO policies: the browser (anon/authenticated) can
-- neither read nor change the list. Only the auth server and you, in the
-- dashboard, can.
alter table public.signup_invites enable row level security;
grant all on table public.signup_invites to supabase_auth_admin;
revoke all on table public.signup_invites from authenticated, anon, public;

-- ── 3. The signup check ────────────────────────────────────────────────────
-- Called by Supabase Auth before it creates any user. Returning {} allows the
-- signup; returning an error object rejects it before the account exists.
create or replace function public.hook_invite_only_signup(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  digits text := regexp_replace(coalesce(event->'user'->>'phone', ''), '\D', '', 'g');
begin
  if digits = '' then
    return jsonb_build_object('error', jsonb_build_object(
      'message', 'Sign up with your phone number.',
      'http_code', 403));
  end if;

  -- A local number (0XXXXXXXXX) is the same person as 233XXXXXXXXX.
  if digits ~ '^0[0-9]{9}$' then
    digits := '233' || substr(digits, 2);
  end if;

  if exists (select 1 from public.signup_invites where phone = digits) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object('error', jsonb_build_object(
    'message', 'This number has not been invited to F2M yet.',
    'http_code', 403));
end;
$$;

grant execute on function public.hook_invite_only_signup to supabase_auth_admin;
revoke execute on function public.hook_invite_only_signup from authenticated, anon, public;

-- ── 4. Your numbers ────────────────────────────────────────────────────────
-- Uncomment, put in the real numbers (233 + 9 digits), and run. Add more any
-- time the same way. To remove one: delete from public.signup_invites where phone = '233…';
--
-- insert into public.signup_invites (phone, note) values
--   ('233XXXXXXXXX', 'me — farmer'),
--   ('233XXXXXXXXX', 'me — buyer'),
--   ('233XXXXXXXXX', 'friend — driver')
-- on conflict (phone) do nothing;
