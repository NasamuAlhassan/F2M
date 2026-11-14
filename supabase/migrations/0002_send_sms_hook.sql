-- F2M · Supabase setup: the Send SMS hook (no SMS yet).
--
-- Supabase will not switch on phone sign-in until it knows how to send an
-- SMS. F2M has no SMS route yet — Ghana needs an approved sender ID first —
-- so this hook stands in for the SMS provider and refuses honestly: anything
-- that would text a code (a password reset, a phone change) gets a clear
-- "SMS isn't available yet" instead of a code that never arrives. Sign-up and
-- sign-in with a password never send an SMS while "Confirm phone" is off, so
-- they are unaffected.
--
-- When the sender ID is approved, this hook is replaced by one that sends
-- through Africa's Talking.
--
-- Run it in: Dashboard → SQL Editor → paste → Run. Safe to run more than once.
-- Then: Authentication → Hooks → Send SMS → Postgres → schema public →
-- function hook_send_sms_unavailable → enable.

create or replace function public.hook_send_sms_unavailable(event jsonb)
returns jsonb
language plpgsql
as $$
begin
  return jsonb_build_object('error', jsonb_build_object(
    'message', 'SMS is not available on F2M yet. Ask the F2M team to reset your password.',
    'http_code', 503));
end;
$$;

grant execute on function public.hook_send_sms_unavailable to supabase_auth_admin;
revoke execute on function public.hook_send_sms_unavailable from authenticated, anon, public;
