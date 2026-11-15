import { z } from 'zod';
import { config } from '../../config';

/**
 * The language-model assist (D-056) — a suggestion engine, never a decision-maker.
 *
 * Three rules hold everywhere it is used:
 *  1. It is OFF unless the owner switches it on (`LLM_PROVIDER=openai-compatible`).
 *  2. It only ever returns a validated, structured object (a Zod schema), and the
 *     caller re-checks every value against the platform's own registries and the
 *     person's own words before using one.
 *  3. Anything it fails at — down, slow, refused, malformed — is `null`, and the
 *     caller carries on with its rules. It can make a feature better, never break it.
 *
 * It runs on open models, hosted by any OpenAI-compatible service (Groq by default;
 * D-059), called over `fetch` as the other providers here call theirs.
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
  readonly name: 'openai-compatible' | 'mock';
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

/** Keywords left out of the schema the model is shown; the Zod check afterwards enforces them instead. */
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

// ── An OpenAI-compatible host of open models (Groq by default) ─────────────────

/** The answer text, without a code fence or a model's stray words around the JSON. */
function jsonText(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced ? fenced[1]! : text).trim();
  if (body.startsWith('{')) return body;
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  return first >= 0 && last > first ? body.slice(first, last + 1) : body;
}

/**
 * Any host that speaks the OpenAI chat-completions API: Groq (the default, free tier),
 * OpenRouter, Hugging Face's router, or a self-hosted server. Switching host is
 * settings only: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL.
 *
 * JSON mode (`response_format: json_object`) is the widely supported dial, so the
 * schema goes in the instructions and the Zod check afterwards is what enforces it.
 */
export class OpenAiCompatibleLlmProvider implements LlmProvider {
  readonly name = 'openai-compatible' as const;

  constructor(
    private readonly opts: {
      apiKey?: string;
      baseUrl?: string;
      model?: string;
      visionModel?: string;
      timeoutMs?: number;
      fetchImpl?: typeof fetch;
    } = {},
  ) {}

  async extract<T>(req: LlmRequest<T>): Promise<T> {
    const apiKey = this.opts.apiKey ?? config.LLM_API_KEY;
    if (!apiKey) throw new LlmError('No LLM API key configured');
    const images = req.images ?? [];
    // Pictures need a model that can see; with none configured the feature carries on without it.
    const model = images.length ? (this.opts.visionModel ?? config.LLM_VISION_MODEL) : (this.opts.model ?? config.LLM_MODEL);
    if (!model) throw new LlmError('No vision model configured');
    const baseUrl = (this.opts.baseUrl ?? config.LLM_BASE_URL).replace(/\/+$/, '');
    const doFetch = this.opts.fetchImpl ?? fetch;

    const system = `${req.system}\n\nAnswer with one JSON object and nothing else. It must match this JSON Schema:\n${JSON.stringify(jsonSchemaFor(req.schema))}`;
    const user = images.length
      ? [
          { type: 'text', text: req.user },
          ...images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.base64}` } })),
        ]
      : req.user;
    const body = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: req.maxTokens ?? 1024,
      temperature: 0,
      response_format: { type: 'json_object' },
    };

    const res = await doFetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? config.LLM_TIMEOUT_MS),
    });
    if (!res.ok) throw new LlmError(`The model host answered ${res.status}`);
    const reply = (await res.json()) as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }>;
    };
    const choice = reply.choices?.[0];
    if (!choice) throw new LlmError('The model host sent no answer');
    if (choice.message?.refusal || choice.finish_reason === 'content_filter') throw new LlmError('The model declined this request');
    if (choice.finish_reason === 'length') throw new LlmError('The answer was cut off');
    let json: unknown;
    try {
      json = JSON.parse(jsonText(choice.message?.content ?? ''));
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
  provider = config.LLM_PROVIDER === 'openai-compatible' ? new OpenAiCompatibleLlmProvider() : null;
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
