import { formatGhs, getFarmerByPhone, t, type Farmer, type I18nText } from '@ftm/core';
import type { IvrCtx } from '../machine';

export const DAY_MS = 24 * 60 * 60 * 1000;

export async function farmerOf(ctx: IvrCtx): Promise<Farmer | undefined> {
  return getFarmerByPhone(ctx.call.phone);
}

/** A whole number typed on the keypad, or null. */
export function typedCount(digits: string, max = 100000): number | null {
  if (!/^\d{1,7}$/.test(digits)) return null;
  const n = Number(digits);
  return n > 0 && n <= max ? n : null;
}

/** A price in whole cedis typed on the keypad → pesewas; 0 → null (let buyers offer); undefined if not a price. */
export function typedPrice(digits: string): number | null | undefined {
  if (!/^\d{1,7}$/.test(digits)) return undefined;
  const ghs = Number(digits);
  return ghs === 0 ? null : ghs * 100;
}

export const priceSay = (pesewas: number) => formatGhs(pesewas);
export const unitSay = (ctx: IvrCtx, unitCode: string) => t(ctx.locale, `unit.${unitCode}`);
export const cropSay = (ctx: IvrCtx, commodityCode: string) => t(ctx.locale, `commodity.${commodityCode}`);

/**
 * A one-line message carried to the next step's prompt ("Done.", "Sorry, we
 * did not catch that."), said once and then forgotten.
 */
export function flash(ctx: IvrCtx, key: string, params?: Record<string, string | number>): void {
  ctx.state._flash = { key, params };
}

export function takeFlash(ctx: IvrCtx): I18nText[] {
  const f = ctx.state._flash as I18nText | undefined;
  delete ctx.state._flash;
  return f ? [f] : [];
}

/** The keys every step answers to, said at the end of each prompt. */
export const HINT_KEY: I18nText = { key: 'voice.common.hintKey' }; // 9 again, 0 back
export const HINT_NUMBER: I18nText = { key: 'voice.common.hintNumber' }; // * then # again
