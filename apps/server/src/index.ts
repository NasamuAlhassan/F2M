import { config, runMigrations } from '@ftm/core';
import { buildServer } from './app';
import { startSweepJobs } from './jobs/sweep';

runMigrations(); // idempotent — brings a fresh checkout up without a manual db step

const app = await buildServer();
startSweepJobs(app.log);
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
