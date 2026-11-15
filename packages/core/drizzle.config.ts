import { defineConfig } from 'drizzle-kit';

// Postgres (docs/HOSTING.md): Supabase in production, PGlite locally and in tests.
// The SQLite migrations 0000–0017 live in git history; this folder starts a
// fresh Postgres baseline (production started empty when F2M moved to Supabase).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
