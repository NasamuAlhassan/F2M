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
    MOCK_PAYMENT_DELAY_MS: z.coerce.number().default(2000),
    PAYMENT_TIMEOUT_MS: z.coerce.number().default(120_000),
    MOMO_BASE_URL: z.string().default('https://sandbox.momodeveloper.mtn.com'),
    MOMO_SUB_KEY_COLLECTIONS: z.string().optional(),
    MOMO_SUB_KEY_DISBURSEMENTS: z.string().optional(),
    MOMO_API_USER: z.string().optional(),
    MOMO_API_KEY: z.string().optional(),
    MOMO_TARGET_ENV: z.string().default('sandbox'),
    MOMO_CURRENCY: z.string().default('EUR'),

    AT_USERNAME: z.string().default('sandbox'),
    AT_API_KEY: z.string().optional(),

    NOTIFY_PROVIDER: z.enum(['mock', 'at']).default('mock'),
    USSD_SHORTCODE: z.string().default('*384*7247#'),
    DISPATCH_OFFER_TTL_MINUTES: z.coerce.number().default(10),

    VOICE_PROVIDER: z.enum(['mock', 'at']).default('mock'),
    AT_VOICE_NUMBER: z.string().optional(),
    VOICE_ANSWER_TIMEOUT_MS: z.coerce.number().default(120_000),

    // Voice listing pipeline (D-038): speech → text → English → parsed lot.
    // Khaya AI (GhanaNLP) slots in per-provider when the key lands.
    ASR_PROVIDER: z.enum(['mock', 'khaya']).default('mock'),
    MT_PROVIDER: z.enum(['mock', 'khaya']).default('mock'),
    TTS_PROVIDER: z.enum(['mock', 'khaya']).default('mock'),
    KHAYA_API_KEY: z.string().optional(),

    // Review gate escape hatch (D-040): 'true' lets machine-drafted catalogs
    // reach farmer-facing surfaces — the owner's own live testing ONLY.
    // Not z.coerce.boolean: the string 'false' would coerce to true.
    I18N_DRAFT_LOCALES_LIVE: z.enum(['true', 'false']).default('false'),
  })
  .superRefine((env, ctx) => {
    // Fail at boot with the exact missing keys for the providers actually selected.
    if (env.GRADING_PROVIDER === 'hf' && !env.HF_TOKEN) {
      ctx.addIssue({ code: 'custom', message: 'GRADING_PROVIDER=hf requires HF_TOKEN' });
    }
    if (env.NOTIFY_PROVIDER === 'at' && !env.AT_API_KEY) {
      ctx.addIssue({ code: 'custom', message: 'NOTIFY_PROVIDER=at requires AT_API_KEY' });
    }
    if ((env.ASR_PROVIDER === 'khaya' || env.MT_PROVIDER === 'khaya' || env.TTS_PROVIDER === 'khaya') && !env.KHAYA_API_KEY) {
      ctx.addIssue({ code: 'custom', message: 'ASR/MT/TTS_PROVIDER=khaya requires KHAYA_API_KEY' });
    }
    if (env.VOICE_PROVIDER === 'at' && (!env.AT_API_KEY || !env.AT_VOICE_NUMBER)) {
      ctx.addIssue({ code: 'custom', message: 'VOICE_PROVIDER=at requires AT_API_KEY and AT_VOICE_NUMBER' });
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
  draftLocalesLive: env.I18N_DRAFT_LOCALES_LIVE === 'true',
};

export type Config = typeof config;
