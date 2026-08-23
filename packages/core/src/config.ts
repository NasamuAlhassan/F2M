import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Repo root = three levels up from packages/core/src/config.ts
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Load .env from the repo root regardless of which workspace's cwd we run under.
try {
  process.loadEnvFile(path.join(REPO_ROOT, '.env'));
} catch {
  // No .env is fine — mock mode needs zero keys (D-013).
}

const envSchema = z
  .object({
    PORT: z.coerce.number().int().default(3000),
    JWT_SECRET: z.string().default('dev-only-secret-change-me'),
    DATABASE_PATH: z.string().default('data/ftm.db'),
    STORAGE_DIR: z.string().default('apps/server/storage'),
    DISPUTE_WINDOW_MINUTES: z.coerce.number().default(10),
    PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),

    GRADING_PROVIDER: z.enum(['mock', 'hf']).default('mock'),
    HF_TOKEN: z.string().optional(),
    GRADING_MODEL: z.string().default('Qwen/Qwen2.5-VL-7B-Instruct'),

    PAYMENT_PROVIDER: z.enum(['mock', 'momo']).default('mock'),
    MOMO_BASE_URL: z.string().default('https://sandbox.momodeveloper.mtn.com'),
    MOMO_SUB_KEY_COLLECTIONS: z.string().optional(),
    MOMO_SUB_KEY_DISBURSEMENTS: z.string().optional(),
    MOMO_API_USER: z.string().optional(),
    MOMO_API_KEY: z.string().optional(),
    MOMO_TARGET_ENV: z.string().default('sandbox'),
    MOMO_CURRENCY: z.string().default('EUR'),

    AT_USERNAME: z.string().default('sandbox'),
    AT_API_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    // Fail at boot with the exact missing keys for the providers actually selected.
    if (env.GRADING_PROVIDER === 'hf' && !env.HF_TOKEN) {
      ctx.addIssue({ code: 'custom', message: 'GRADING_PROVIDER=hf requires HF_TOKEN' });
    }
    if (env.PAYMENT_PROVIDER === 'momo') {
      for (const key of ['MOMO_SUB_KEY_COLLECTIONS', 'MOMO_SUB_KEY_DISBURSEMENTS', 'MOMO_API_USER', 'MOMO_API_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: 'custom', message: `PAYMENT_PROVIDER=momo requires ${key}` });
        }
      }
    }
  });

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const messages = parsed.error.issues.map((i) => `  - ${i.path.join('.') || i.message}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${messages}`);
}

const env = parsed.data;

export const config = {
  ...env,
  databasePath: path.isAbsolute(env.DATABASE_PATH) ? env.DATABASE_PATH : path.join(REPO_ROOT, env.DATABASE_PATH),
  storageDir: path.isAbsolute(env.STORAGE_DIR) ? env.STORAGE_DIR : path.join(REPO_ROOT, env.STORAGE_DIR),
};

export type Config = typeof config;
