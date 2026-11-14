import { config } from '../config';

/**
 * Client for the owner's Tɛkyerɛma language Space (D-045) — the Hugging Face
 * Space that hears, translates and speaks Ghanaian languages on the owner's
 * own models. It is a Gradio app, so every call is the two-step REST dialect:
 *
 *   POST {host}/gradio_api/call/{endpoint}        {"data": [...args]}  → {"event_id"}
 *   GET  {host}/gradio_api/call/{endpoint}/{id}   → server-sent events, ending in
 *        `event: complete` + `data: [...results]`  (or `event: error`)
 *
 * No key is needed — the Space is public. Everything here is plain fetch, so
 * the three providers that use it (ASR, MT, TTS) stay testable with a stubbed
 * fetch, like every other provider.
 */

/**
 * F2M locale → the Space's language code. This is the one
 * translation point, so a locale the Space lacks (Ga isn't in F2M either)
 * fails loudly instead of sending a code the service misreads.
 */
export const LOCALE_TO_SPACE: Record<string, string | undefined> = {
  en: 'eng',
  tw: 'twi',
  ee: 'ewe',
  ha: 'hau',
  dag: 'dag',
  kus: 'kus',
};

export function spaceLang(locale: string): string {
  const code = LOCALE_TO_SPACE[locale];
  if (!code) throw new Error(`The language Space has no language code for locale '${locale}'`);
  return code;
}

export interface SpaceCallOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

/** A Gradio file result — the Space hands back audio as one of these. */
export interface SpaceFile {
  path?: string;
  url?: string | null;
  orig_name?: string;
}

/** Pull the last `event:` block out of an SSE body and decode it. */
function parseEventStream(body: string): { event: string; data: unknown } {
  const blocks = body.trim().split(/\n\n+/);
  const last = blocks[blocks.length - 1] ?? '';
  const event = /^event:\s*(\S+)/m.exec(last)?.[1] ?? 'unknown';
  const raw = /^data:\s*([\s\S]*)$/m.exec(last)?.[1]?.trim() ?? '';
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    // keep the raw text — error events are sometimes plain strings
  }
  return { event, data };
}

/** A connection that dropped (reset, closed mid-body) — worth one more try; a timeout or the Space's own error is not. */
class SpaceNetworkError extends Error {}

/**
 * Call one named Gradio endpoint and return its result array. Throws an Error
 * with a message a person can act on: unreachable/asleep, a non-2xx, or the
 * Space's own error text. A dropped connection is retried once (a Space behind
 * a shared edge resets idle sockets now and then); everything else is not.
 */
export async function spaceCall(endpoint: string, args: unknown[], opts: SpaceCallOptions = {}): Promise<unknown[]> {
  try {
    return await spaceCallOnce(endpoint, args, opts);
  } catch (err) {
    if (!(err instanceof SpaceNetworkError)) throw err;
    return spaceCallOnce(endpoint, args, opts);
  }
}

async function spaceCallOnce(endpoint: string, args: unknown[], opts: SpaceCallOptions): Promise<unknown[]> {
  const base = (opts.baseUrl ?? config.SPACE_URL).replace(/\/+$/, '');
  const signal = AbortSignal.timeout(opts.timeoutMs ?? config.SPACE_TIMEOUT_MS);
  const isTimeout = (err: unknown) => err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');

  let post: Response;
  try {
    post = await fetch(`${base}/gradio_api/call/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: args }),
      signal,
    });
  } catch (err) {
    const message = `Language Space unreachable at ${base} (${err instanceof Error ? err.message : err})`;
    throw isTimeout(err) ? new Error(message) : new SpaceNetworkError(message);
  }
  if (!post.ok) throw new Error(`Language Space ${endpoint} failed to start: ${post.status} ${(await post.text()).slice(0, 200)}`);
  const started = (await post.json().catch(() => null)) as { event_id?: string } | null;
  if (!started?.event_id) throw new Error(`Language Space ${endpoint} returned no event id — is the Space asleep or rebuilding?`);

  let stream: Response;
  let body: string;
  try {
    stream = await fetch(`${base}/gradio_api/call/${endpoint}/${started.event_id}`, { signal });
    if (!stream.ok) throw new Error(`Language Space ${endpoint} failed: ${stream.status} ${(await stream.text()).slice(0, 200)}`);
    body = await stream.text();
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Language Space')) throw err;
    const message = `Language Space ${endpoint} did not answer (${err instanceof Error ? err.message : err})`;
    throw isTimeout(err) ? new Error(message) : new SpaceNetworkError(message);
  }

  const { event, data } = parseEventStream(body);
  if (event !== 'complete') {
    throw new Error(`Language Space ${endpoint} error: ${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data)}`);
  }
  if (!Array.isArray(data)) throw new Error(`Language Space ${endpoint} returned an unexpected result`);
  return data;
}

/** Absolute URL for a Gradio file result. */
export function spaceFileUrl(file: SpaceFile, baseUrl: string = config.SPACE_URL): string | null {
  if (file.url) return file.url;
  if (file.path) return `${baseUrl.replace(/\/+$/, '')}/gradio_api/file=${file.path}`;
  return null;
}
