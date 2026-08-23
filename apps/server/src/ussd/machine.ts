import { db, getFarmerByPhone, resolveText, schema, type Farmer, type I18nText } from '@ftm/core';
import { eq } from 'drizzle-orm';

const SESSION_TTL_MS = 5 * 60 * 1000; // a stale session restarts at home on re-dial

export interface UssdCtx {
  phone: string; // normalized E.164 where possible
  farmer: Farmer | null;
  locale: string;
  data: Record<string, unknown>; // persisted in ussd_sessions.ctx between requests
}

export type ScreenResult =
  | { next: string } // transition; the next screen renders
  | { end: I18nText[] } // terminate the session with an END message
  | { error: I18nText }; // re-render this screen with an error line on top

/**
 * A USSD screen. render/handleInput return i18n {key, params} — never strings.
 * The serializer at the bottom of handleUssdRequest is the only place t() runs,
 * so hardcoded user-facing text has nowhere to live (D-012).
 */
export interface UssdScreen {
  key: string;
  render(ctx: UssdCtx): I18nText[];
  handleInput(input: string, ctx: UssdCtx): ScreenResult;
}

const registry = new Map<string, UssdScreen>();

export function registerScreens(...screens: UssdScreen[]): void {
  for (const s of screens) registry.set(s.key, s);
}

export interface UssdRequest {
  sessionId: string;
  phoneNumber: string;
  text: string; // Africa's Talking sends the full '*'-joined input history
}

/** Entry screen depends on whether the phone is registered. */
function entryScreen(ctx: UssdCtx): string {
  return ctx.farmer ? 'home' : 'welcome';
}

export function handleUssdRequest(req: UssdRequest): string {
  const farmer = getFarmerByPhone(req.phoneNumber) ?? null;
  const ctx: UssdCtx = {
    phone: req.phoneNumber,
    farmer,
    locale: farmer?.locale ?? 'en',
    data: {},
  };

  // Only the LAST '*'-segment is this request's input — our menus are dynamic
  // numbered lists, so state lives server-side, not in the input history (D-008).
  const segments = req.text.split('*');
  const input = (segments[segments.length - 1] ?? '').trim();

  const now = Date.now();
  let session = db.select().from(schema.ussdSessions).where(eq(schema.ussdSessions.sessionId, req.sessionId)).get();
  if (session && now - session.updatedAt > SESSION_TTL_MS) {
    db.delete(schema.ussdSessions).where(eq(schema.ussdSessions.sessionId, req.sessionId)).run();
    session = undefined;
  }

  if (!session || req.text === '') {
    // Fresh dial: create/replace the session and render the entry screen.
    const screenKey = entryScreen(ctx);
    const screen = registry.get(screenKey);
    if (!screen) throw new Error(`USSD screen missing: ${screenKey}`);
    const lines = screen.render(ctx);
    saveSession(req.sessionId, ctx, screenKey);
    return serialize('CON', lines, ctx.locale);
  }

  ctx.data = JSON.parse(session.ctx) as Record<string, unknown>;
  const screen = registry.get(session.screen) ?? registry.get(entryScreen(ctx))!;

  let result: ScreenResult;
  try {
    result = screen.handleInput(input, ctx);
  } catch (err) {
    // A domain error mid-flow becomes a terse error line, not a dead session.
    const message = err instanceof Error ? err.message : 'error';
    result = { error: { key: 'ussd.common.error', params: { message } } };
  }

  if ('end' in result) {
    db.delete(schema.ussdSessions).where(eq(schema.ussdSessions.sessionId, req.sessionId)).run();
    return serialize('END', result.end, ctx.locale);
  }

  if ('error' in result) {
    const lines = [result.error, ...screen.render(ctx)];
    saveSession(req.sessionId, ctx, screen.key);
    return serialize('CON', lines, ctx.locale);
  }

  const nextScreen = registry.get(result.next);
  if (!nextScreen) throw new Error(`USSD screen missing: ${result.next}`);
  // Refresh farmer — registration may have just completed inside handleInput.
  ctx.farmer = getFarmerByPhone(req.phoneNumber) ?? null;
  const lines = nextScreen.render(ctx);
  saveSession(req.sessionId, ctx, nextScreen.key);
  return serialize('CON', lines, ctx.locale);
}

function saveSession(sessionId: string, ctx: UssdCtx, screen: string): void {
  const values = {
    sessionId,
    phone: ctx.phone,
    screen,
    ctx: JSON.stringify(ctx.data),
    updatedAt: Date.now(),
  };
  db.insert(schema.ussdSessions)
    .values(values)
    .onConflictDoUpdate({ target: schema.ussdSessions.sessionId, set: values })
    .run();
}

function serialize(kind: 'CON' | 'END', lines: I18nText[], locale: string): string {
  return `${kind} ${lines.map((l) => resolveText(locale, l)).join('\n')}`;
}
