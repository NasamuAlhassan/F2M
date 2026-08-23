import { config, runMigrations } from '@ftm/core';
import { buildServer } from './app';
import { startSweepJobs } from './jobs/sweep';

runMigrations(); // idempotent — brings a fresh checkout up without a manual db step

const app = await buildServer();
startSweepJobs(app.log);
try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  app.log.info(`Farm to Market server on :${config.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
