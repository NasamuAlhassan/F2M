import { config, loadRegistries, runMigrations, seed } from '@ftm/core';
import { buildServer } from './app';
import { startSweepJobs } from './jobs/sweep';

/**
 * Locally (and on any always-on host): migrate, seed what is missing, run the
 * sweep timers, listen.
 *
 * On Vercel (docs/HOSTING.md) this module is the function. Migrations and the
 * seed ran in the build (`vercel-build`), so a cold start only loads the
 * registry cache. There are no timers: Supabase's pg_cron calls
 * /api/cron/sweep. Vercel's Fastify runtime takes over listen().
 */
const onVercel = Boolean(process.env.VERCEL);

if (onVercel) {
  await loadRegistries();
} else {
  await runMigrations(); // idempotent — brings a fresh checkout (PGlite under data/) up with no manual step
  // Reference data too, insert-only: a crop added to the seed reaches an existing
  // database on the next start, and nothing already there changes.
  await seed({ refresh: false });
}

const app = await buildServer();
if (!onVercel) startSweepJobs(app.log);
try {
  // '::' = dual-stack (IPv6 + IPv4-mapped): localhost stays reachable over ::1
  // even when another program squats the IPv4 loopback on the same port, as a
  // VPN's local service was observed doing on 127.0.0.1:3000.
  await app.listen({ port: config.PORT, host: '::' });
  app.log.info(`Farm to Market server on :${config.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export default app;
