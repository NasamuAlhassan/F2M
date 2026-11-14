import { z } from 'zod';
import { config } from '../../config';

/**
 * The language-model assist (D-056) — a suggestion engine, never a decision-maker.
 *
 * Three rules hold everywhere it is used:
 *  1. It is OFF unless the owner switches it on (`LLM_PROVIDER=anthropic`).
 *  2. It only ever returns a validated, structured object (a Zod schema), and the
 *     caller re-checks every value against the platform's own registries and the
 *     person's own words before using one.
 *  3. Anything it fails at — down, slow, refused, malformed — is `null`, and the
 *     caller carries on with its rules. It can make a feature better, never break it.
 *
 * It calls Anthropic's Messages API over `fetch`, as the other providers here do
 * with theirs; the request is exactly the documented shape (structured output via
 * `output_config.format`).
 */

export interface LlmImage {
  mime: string; // image/jpeg, image/png, image/webp, image/gif
  base64: string;
}

export interface LlmRequest<T> {
  /** What the model is and what it must not do. */
  system: string;
  /** The (already scrubbed) text to read. */
  user: string;
  schema: z.ZodType<T>;
  images?: LlmImage[];
  maxTokens?: number;
}

export interface LlmProvider {
  readonly name: 'anthropic' | 'mock';
  extract<T>(req: LlmRequest<T>): Promise<T>;
}

export class LlmError extends Error {}

// ── Keeping personal details out ─────────────────────────────────────────────

/**
 * Remove what identifies a person before text leaves the server: phone numbers
 * (Ghanaian formats, with or without country code or spaces) and e-mail
 * addresses. Names are not machine-detectable, so callers never send a name or
 * an id — only the sentence being understood.
 */
export function scrubPii(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/(\+?233[\s-]?|\b0)\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g, '[phone]')
    .replace(/\b\d{9,13}\b/g, '[number]');
}

// ── Zod → the JSON Schema the API accepts ────────────────────────────────────

/** Keywords structured outputs do not take; the Zod check afterwards enforces them instead. */
const UNSUPPORTED = new Set(['$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'default']);

function plainSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(plainSchema);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (!UNSUPPORTED.has(k)) out[k] = plainSchema(v);
    }
    return out;
  }
  return node;
}

export function jsonSchemaFor(schema: z.ZodType): unknown {
  return plainSchema(z.toJSONSchema(schema));
}

// ── Anthropic ────────────────────────────────────────────────────────────────

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';
/** Models whose refusals the API can rescue on a fallback model (docs: refusals-and-fallback). */
const FALLBACK_MODELS = /^claude-(opus-5-5|opus-5|fable-5|sonnet-5-5)/;

export class AnthropicLlmProvider implements LlmProvider {
  readonly name = 'anthropic' as const;

  constructor(private readonly opts: { apiKey?: string; model?: string; effort?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {}

  async extract<T>(req: LlmRequest<T>): Promise<T> {
    const apiKey = this.opts.apiKey ?? config.ANTHROPIC_API_KEY;
    if (!apiKey) throw new LlmError('No Anthropic API key configured');
    const model = this.opts.model ?? config.LLM_MODEL;
    const doFetch = this.opts.fetchImpl ?? fetch;

    const content: unknown[] = [
      ...(req.images ?? []).map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.base64 } })),
      { type: 'text', text: req.user },
    ];
    const body: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens ?? 1024,
      system: req.system,
      messages: [{ role: 'user', content }],
      // No `thinking`, `temperature` or prefill: the current models reject them. Effort is the one dial.
      output_config: { effort: this.opts.effort ?? config.LLM_EFFORT, format: { type: 'json_schema', schema: jsonSchemaFor(req.schema) } },
    };
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': API_VERSION };
    // Opt in to the refusal rescue by default, where the model supports it.
    if (FALLBACK_MODELS.test(model)) {
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body.fallbacks = 'default';
    }

    const res = await doFetch(API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? config.LLM_TIMEOUT_MS),
    });
    if (!res.ok) throw new LlmError(`Anthropic answered ${res.status}`);
    const reply = (await res.json()) as { stop_reason?: string; content?: Array<{ type: string; text?: string }> };
    if (reply.stop_reason === 'refusal') throw new LlmError('The model declined this request');
    if (reply.stop_reason === 'max_tokens') throw new LlmError('The answer was cut off');
    const text = (reply.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmError('The answer was not JSON');
    }
    const parsed = req.schema.safeParse(json);
    if (!parsed.success) throw new LlmError(`The answer did not fit the schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    return parsed.data;
  }
}

// ── Choosing one ─────────────────────────────────────────────────────────────

let provider: LlmProvider | null | undefined;

/** The configured provider, or null when the assist is off. */
export function getLlmProvider(): LlmProvider | null {
  if (provider !== undefined) return provider;
  provider = config.LLM_PROVIDER === 'anthropic' ? new AnthropicLlmProvider() : null;
  return provider;
}

/** Test hook: install a provider, or `null` for "off", or `undefined` to go back to the configured one. */
export function setLlmProvider(p: LlmProvider | null | undefined): void {
  provider = p;
}

export function llmEnabled(): boolean {
  return getLlmProvider() !== null;
}

/**
 * Ask, and get `null` for any failure. This is the only way features should call
 * the model: a problem here must never reach a farmer on a call or a buyer at a form.
 */
export async function askLlm<T>(req: LlmRequest<T>): Promise<T | null> {
  const p = getLlmProvider();
  if (!p) return null;
  try {
    return await p.extract({ ...req, user: scrubPii(req.user) });
  } catch {
    return null;
  }
}
