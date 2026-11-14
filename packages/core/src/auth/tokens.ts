import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config';
import { DomainError } from '../domain/errors';

/**
 * Verifying a web login (D-047). The browser signs in with Supabase and sends
 * its access token; the server checks the signature against the project's
 * public keys (JWKS) — no shared secret, nothing private on this server.
 */
export interface VerifiedLogin {
  /** The Supabase user id — the JWT `sub`. */
  authUserId: string;
  /** The phone the login was made with, as Supabase stores it (digits, no plus), or null for non-phone logins. */
  phone: string | null;
}

export type TokenVerifier = (token: string) => Promise<VerifiedLogin>;

// Kept in one process-wide slot rather than a module variable: under vitest
// (and tsx with differently-cased Windows paths) this file can be loaded
// twice, and a verifier installed through one copy must be the one every
// other copy uses.
const SLOT = Symbol.for('ftm.auth.tokenVerifier');
const slot = globalThis as unknown as Record<symbol, TokenVerifier | null | undefined>;

function supabaseVerifier(): TokenVerifier {
  const base = config.supabaseUrl;
  if (!base) {
    throw new DomainError('Web logins are not configured on this server (set VITE_SUPABASE_URL)', 'AUTH_NOT_CONFIGURED', 503);
  }
  const issuer = `${base}/auth/v1`;
  // jose caches the key set and refetches on an unknown key id, so key
  // rotation in Supabase needs no restart here.
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: 'authenticated' });
    if (!payload.sub) throw new Error('token has no subject');
    const phone = typeof payload.phone === 'string' && payload.phone ? payload.phone : null;
    return { authUserId: payload.sub, phone };
  };
}

/** Throws on any invalid, expired or foreign token. */
export async function verifyAccessToken(token: string): Promise<VerifiedLogin> {
  slot[SLOT] ??= supabaseVerifier();
  return slot[SLOT](token);
}

/** Test/demo hook — swap how tokens are verified (null = back to Supabase). */
export function setTokenVerifier(v: TokenVerifier | null): void {
  slot[SLOT] = v;
}
