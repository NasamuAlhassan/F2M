import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

/**
 * Where photos, recordings and voice clips live (docs/HOSTING.md).
 *
 * - `disk`: files under STORAGE_DIR, served by the server at /photos, /tts and
 *   /recordings. Local dev and tests.
 * - `supabase`: a public Supabase Storage bucket (`media`). Serverless
 *   functions have no lasting disk. Uploads use a server-only service key that
 *   the owner sets in Vercel and that never reaches a browser.
 *
 * A key is the file's path inside the store, e.g. `photos/<lotId>/<file>.jpg`
 * or `tts/tw/<hash>.wav`; it is what the database keeps.
 */
export interface MediaStore {
  readonly name: 'disk' | 'supabase';
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  read(key: string): Promise<Buffer | null>;
  exists(key: string): Promise<boolean>;
  /** The address a browser, the voice gateway or the language Space fetches it from. */
  url(key: string, opts?: { absolute?: boolean }): string;
}

class DiskStore implements MediaStore {
  readonly name = 'disk' as const;
  constructor(private readonly root: string) {}
  private file(key: string) {
    return path.join(this.root, ...key.split('/'));
  }
  async put(key: string, bytes: Buffer): Promise<void> {
    const file = this.file(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
  }
  async read(key: string): Promise<Buffer | null> {
    const file = this.file(key);
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  }
  async exists(key: string): Promise<boolean> {
    return fs.existsSync(this.file(key));
  }
  url(key: string, opts: { absolute?: boolean } = {}): string {
    // Same origin as the portal: relative for browsers, absolute for the voice gateway and the Space.
    return opts.absolute ? `${config.PUBLIC_BASE_URL}/${key}` : `/${key}`;
  }
}

class SupabaseStore implements MediaStore {
  readonly name = 'supabase' as const;
  constructor(
    private readonly base: string,
    private readonly serviceKey: string,
    private readonly bucket = 'media',
  ) {}
  private objectUrl(key: string) {
    return `${this.base}/storage/v1/object/${this.bucket}/${key}`;
  }
  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    const res = await fetch(this.objectUrl(key), {
      method: 'POST',
      // Both headers: a new-style `sb_secret_…` key is only accepted via `apikey`
      // (and as a Bearer only when it equals `apikey`); a legacy service_role JWT works either way.
      headers: {
        apikey: this.serviceKey,
        authorization: `Bearer ${this.serviceKey}`,
        'content-type': contentType,
        'x-upsert': 'true',
      },
      body: new Uint8Array(bytes),
    });
    if (!res.ok) throw new Error(`Storage upload failed (${res.status}): ${await res.text().catch(() => '')}`);
  }
  async read(key: string): Promise<Buffer | null> {
    const res = await fetch(this.url(key));
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  }
  async exists(key: string): Promise<boolean> {
    const res = await fetch(this.url(key), { method: 'HEAD' });
    return res.ok;
  }
  url(key: string): string {
    return `${this.base}/storage/v1/object/public/${this.bucket}/${key}`;
  }
}

let store: MediaStore | null = null;

export function getMediaStore(): MediaStore {
  if (!store) {
    store =
      config.STORAGE_PROVIDER === 'supabase'
        ? new SupabaseStore(config.supabaseUrl!, config.SUPABASE_SERVICE_ROLE_KEY!)
        : new DiskStore(config.storageDir);
  }
  return store;
}

/** A store on a folder of its own (tests, or a cache that must stay local). */
export function diskStore(root: string): MediaStore {
  return new DiskStore(root);
}

/** Test hook. */
export function setMediaStore(s: MediaStore | null): void {
  store = s;
}

/** A media key as the URL screens should use. */
export function mediaUrl(key: string): string {
  return getMediaStore().url(key);
}

/** A media key as an absolute URL (for the voice gateway's <Play> and the Space). */
export function mediaUrlAbsolute(key: string): string {
  return getMediaStore().url(key, { absolute: true });
}
