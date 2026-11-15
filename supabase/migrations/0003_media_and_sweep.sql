-- F2M on Vercel + Supabase (docs/HOSTING.md). Run once in the Supabase SQL
-- editor, after the server has been deployed once (you need its URL below).
--
-- 1. A public bucket for photos, recordings and voice clips. Public = readable
--    by anyone with the link (the voice gateway and the language Space must
--    fetch clips without logging in); only the server's service key can write.
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

-- 2. The sweep: F2M's background work (offer expiry, calls, payment checks,
--    SMS, the 24-hour receipt clock) runs when this calls the server.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Two secrets, stored encrypted in Supabase Vault. Replace both values:
--   the server's sweep address, e.g. https://f2m-server.vercel.app/api/cron/sweep
--   the same long random string you set as CRON_SECRET in the server's Vercel settings.
select vault.create_secret('https://REPLACE-WITH-YOUR-SERVER.vercel.app/api/cron/sweep', 'f2m_sweep_url');
select vault.create_secret('REPLACE-WITH-YOUR-CRON-SECRET', 'f2m_cron_secret');

-- Every minute: the full sweep.
select cron.schedule(
  'f2m-sweep',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'f2m_sweep_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'f2m_cron_secret')
    ),
    body := '{"lane":"slow"}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- Every 20 seconds: payment checks, SMS and calls, so a farmer's message does
-- not wait a minute. (Supabase's pg_cron accepts '20 seconds'. If yours refuses
-- it, delete this job: the every-minute sweep does the same work, just slower.)
select cron.schedule(
  'f2m-fast',
  '20 seconds',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'f2m_sweep_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'f2m_cron_secret')
    ),
    body := '{"lane":"fast"}'::jsonb,
    timeout_milliseconds := 18000
  );
  $$
);

-- To check: select * from cron.job; select * from net._http_response order by created desc limit 5;
-- To stop:  select cron.unschedule('f2m-sweep'); select cron.unschedule('f2m-fast');
