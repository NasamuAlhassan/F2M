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

/** A blank line in .env (`NAME=`) means "not set", not "set to nothing". */
const blankIsUnset = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema);

const envSchema = z
  .object({
    PORT: z.coerce.number().int().default(3000),
    // Web logins (D-047): the server verifies Supabase tokens against this
    // project's public keys. The same value the browser uses, so one setting.
    VITE_SUPABASE_URL: z.string().optional(),
    // Supabase Postgres (session pooler URL, port 5432) in production. Unset → PGlite at
    // DATABASE_PATH (a folder; ':memory:' for tests). docs/HOSTING.md.
    DATABASE_URL: blankIsUnset(z.string().url().optional()),
    DATABASE_PATH: z.string().default('data/pglite'),
    STORAGE_DIR: z.string().default('apps/server/storage'),
    // Where photos, recordings and voice clips go (docs/HOSTING.md): 'disk' under STORAGE_DIR,
    // or 'supabase' — the public 'media' bucket, written with the server-only service key.
    STORAGE_PROVIDER: z.enum(['disk', 'supabase']).default('disk'),
    SUPABASE_SERVICE_ROLE_KEY: blankIsUnset(z.string().optional()),
    // The secret Supabase's pg_cron sends to POST /api/cron/sweep. Unset = the endpoint is closed.
    CRON_SECRET: blankIsUnset(z.string().min(16).optional()),
    DISPUTE_WINDOW_MINUTES: z.coerce.number().default(10),
    // Phase 3 settlement (the owner's rules, docs/PHASE3.md): the share of the
    // agreed total paid to the farmer at pickup, how long a buyer has to confirm
    // or report a problem, and how long a farmer has to answer a claim.
    FARMER_ADVANCE_PERCENT: z.coerce.number().min(0).max(100).default(30),
    RECEIPT_WINDOW_HOURS: z.coerce.number().positive().default(24),
    CLAIM_ANSWER_HOURS: z.coerce.number().positive().default(24),
    PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),

    // 'hf' = an open vision model over an OpenAI-compatible API (the name predates other hosts).
    GRADING_PROVIDER: z.enum(['mock', 'hf']).default('mock'),
    HF_TOKEN: z.string().optional(),
    // Where grading runs. Default: Hugging Face's router (HF_TOKEN). On the AI assist's host
    // (e.g. Groq, model qwen/qwen3.8-27b) it uses LLM_API_KEY unless GRADING_API_KEY is set.
    GRADING_BASE_URL: z.string().default('https://router.huggingface.co/v1'),
    GRADING_API_KEY: blankIsUnset(z.string().optional()),
    // Must exist in the HF router catalog (GET router.huggingface.co/v1/models);
    // the original 7B VL retired from the router, verified live 2026-08-24.
    GRADING_MODEL: z.string().default('Qwen/Qwen3-VL-30B-A3B-Instruct'),

    // Payments are simulated until Phase 3 picks a licensed payment provider
    // (docs/COSTS.md §6). The value still matters: demo-only shortcuts such as
    // "accept for the farmer" are locked to 'mock' and stay locked when a real
    // provider is added here.
    PAYMENT_PROVIDER: z.enum(['mock']).default('mock'),
    MOCK_PAYMENT_DELAY_MS: z.coerce.number().default(2000),
    PAYMENT_TIMEOUT_MS: z.coerce.number().default(120_000),

    AT_USERNAME: z.string().default('sandbox'),
    AT_API_KEY: z.string().optional(),

    NOTIFY_PROVIDER: z.enum(['mock', 'at']).default('mock'),
    USSD_SHORTCODE: z.string().default('*384*7247#'),
    DISPATCH_OFFER_TTL_MINUTES: z.coerce.number().default(10),
    // A listing lapses this many days after it was listed or last changed (Phase 1).
    LISTING_TTL_DAYS: z.coerce.number().default(30),

    // Live prices (D-053). F2M's own deals and asking prices feed the price engine
    // by themselves; these bring in outside data too. PRICE_FEED_URL is polled for
    // the JSON shape in docs/PRICES.md; PRICE_INGEST_TOKEN lets a partner POST that
    // shape to /api/feeds/prices (off until set); PRICE_FEED_HDX loads WFP's
    // 2006-2023 Ghana history once, for seasonality.
    PRICE_FEED_URL: blankIsUnset(z.string().url().optional()),
    PRICE_FEED_TOKEN: blankIsUnset(z.string().optional()),
    PRICE_FEED_INTERVAL_MINUTES: z.coerce.number().default(360),
    PRICE_INGEST_TOKEN: blankIsUnset(z.string().min(16).optional()),
    PRICE_FEED_HDX: z.enum(['true', 'false']).default('false'),

    // Smart alerts (D-055): how many people one new listing or request may reach,
    // how many alert SMS one farmer may get in a day, and how far a crop's price
    // must move in two weeks before sellers and buyers are told.
    ALERT_MAX_RECIPIENTS: z.coerce.number().int().min(0).default(8),
    ALERT_SMS_PER_FARMER_PER_DAY: z.coerce.number().int().min(0).default(2),
    ALERT_PRICE_MOVE_PCT: z.coerce.number().min(1).default(10),

    // The language-model assist (D-056, D-059). OFF by default: with 'off' every feature runs
    // on its own rules, exactly as before. 'openai-compatible' sends short, scrubbed pieces
    // of text (a farmer's listing sentence, a buyer's typed request) to an open model on an
    // OpenAI-compatible host: Groq by default, free tier. The owner chose this (D-059).
    LLM_PROVIDER: z.enum(['off', 'openai-compatible']).default('off'),
    LLM_BASE_URL: z.string().default('https://api.groq.com/openai/v1'),
    LLM_API_KEY: blankIsUnset(z.string().optional()),
    LLM_MODEL: z.string().default('openai/gpt-oss-120b'),
    // For the listing-photo check. Unset = that check is skipped (grading has its own model).
    LLM_VISION_MODEL: blankIsUnset(z.string().optional()),
    LLM_TIMEOUT_MS: z.coerce.number().default(8000),

    VOICE_PROVIDER: z.enum(['mock', 'at']).default('mock'),
    AT_VOICE_NUMBER: z.string().optional(),
    VOICE_ANSWER_TIMEOUT_MS: z.coerce.number().default(120_000),

    // Language layer (D-038, D-045): speech → text → English → parsed lot, and
    // the IVR's local-language voice. 'space' = the owner's own Hugging Face
    // language Space: hears, translates and speaks Twi/Ewe/Kusaal/Dagbani/Hausa
    // on their own models, public and keyless. 'mock' = offline stand-ins.
    ASR_PROVIDER: z.enum(['mock', 'space']).default('mock'),
    MT_PROVIDER: z.enum(['mock', 'space']).default('mock'),
    TTS_PROVIDER: z.enum(['mock', 'space']).default('mock'),
    SPACE_URL: z.string().default('https://princealhassannasamu-tekyerema-lang.hf.space'),
    // Cold first calls load a model (measured 33 s for English hearing), so the
    // ceiling is generous; the TTS provider applies its own, shorter budget.
    SPACE_TIMEOUT_MS: z.coerce.number().default(60_000),

    // The phone simulator (D-047): 'true' turns on the /phone handset, the
    // USSD/IVR tester pages and their SMS/call inboxes, so real numbers can be
    // tested before a live USSD code and voice number exist. Anyone who can
    // reach the server can then act as any phone, so it is for a closed test
    // group only — 'false' once the real carrier is live.
    SIMULATOR_ENABLED: z.enum(['true', 'false']).default('true'),
    // A secret Africa's Talking must send with every USSD/voice callback
    // (?token=…) once the simulator is off. AT has no request signing, so an
    // unguessable value in the callback URL is their own recommendation.
    CARRIER_WEBHOOK_TOKEN: z.string().optional(),

    // Review gate escape hatch (D-040): 'true' lets machine-drafted catalogs
    // reach farmer-facing surfaces — the owner's own live testing ONLY.
    // Not z.coerce.boolean: the string 'false' would coerce to true.
    I18N_DRAFT_LOCALES_LIVE: z.enum(['true', 'false']).default('false'),
  })
  .superRefine((env, ctx) => {
    // Fail at boot with the exact missing keys for the providers actually selected.
    if (env.GRADING_PROVIDER === 'hf') {
      const trim = (url: string) => url.replace(/\/+$/, '');
      const sameHostAsAssist = trim(env.GRADING_BASE_URL) === trim(env.LLM_BASE_URL);
      const key = env.GRADING_API_KEY ?? (sameHostAsAssist ? env.LLM_API_KEY : env.HF_TOKEN);
      if (!key) {
        ctx.addIssue({
          code: 'custom',
          message: "GRADING_PROVIDER=hf needs a key: GRADING_API_KEY, or HF_TOKEN (Hugging Face), or LLM_API_KEY when grading on the assist's host",
        });
      }
    }
    if (env.LLM_PROVIDER === 'openai-compatible' && !env.LLM_API_KEY) {
      ctx.addIssue({ code: 'custom', message: 'LLM_PROVIDER=openai-compatible requires LLM_API_KEY (a Groq key by default)' });
    }
    if (env.NOTIFY_PROVIDER === 'at' && !env.AT_API_KEY) {
      ctx.addIssue({ code: 'custom', message: 'NOTIFY_PROVIDER=at requires AT_API_KEY' });
    }
    if (env.VOICE_PROVIDER === 'at' && (!env.AT_API_KEY || !env.AT_VOICE_NUMBER)) {
      ctx.addIssue({ code: 'custom', message: 'VOICE_PROVIDER=at requires AT_API_KEY and AT_VOICE_NUMBER' });
    }
    if (env.STORAGE_PROVIDER === 'supabase' && (!env.SUPABASE_SERVICE_ROLE_KEY || !env.VITE_SUPABASE_URL)) {
      ctx.addIssue({ code: 'custom', message: 'STORAGE_PROVIDER=supabase requires SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL' });
    }
    if (env.SIMULATOR_ENABLED === 'false' && !env.CARRIER_WEBHOOK_TOKEN) {
      ctx.addIssue({
        code: 'custom',
        message: 'SIMULATOR_ENABLED=false requires CARRIER_WEBHOOK_TOKEN — otherwise anyone can drive the USSD and voice endpoints',
      });
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
  supabaseUrl: env.VITE_SUPABASE_URL ? env.VITE_SUPABASE_URL.replace(/\/+$/, '') : null,
  simulatorEnabled: env.SIMULATOR_ENABLED === 'true',
};

export type Config = typeof config;
