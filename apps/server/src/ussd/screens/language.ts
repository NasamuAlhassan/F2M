import { liveLocales, updateDriverProfile, updateFarmerProfile, type I18nText } from '@ftm/core';
import type { UssdScreen } from '../machine';
import { invalid } from './common';

// Language screens (D-040). Only LIVE locales are offered — reviewed catalogs,
// or drafts under the owner's I18N_DRAFT_LOCALES_LIVE escape hatch. Endonyms
// ride as params through the pure-placeholder ussd.listItem, so the menu names
// each language in itself and needs no translation of its own.

function localeLines(titleKey: string, withBack: boolean): I18nText[] {
  const lines: I18nText[] = [
    { key: titleKey },
    ...liveLocales().map((l, i) => ({ key: 'ussd.listItem', params: { n: i + 1, label: l.endonym } })),
  ];
  if (withBack) lines.push({ key: 'ussd.common.back' });
  return lines;
}

function pickLocale(input: string): { code: string; endonym: string } | null {
  const n = Number(input);
  const options = liveLocales();
  if (!Number.isInteger(n) || n < 1 || n > options.length) return null;
  const chosen = options[n - 1]!;
  return { code: chosen.code, endonym: chosen.endonym };
}

/**
 * A brand-new caller's very first screen when more than English is live: the
 * one choice that must be made before any language can be assumed.
 */
export const langWelcome: UssdScreen = {
  key: 'lang_welcome',
  render: () => localeLines('ussd.lang.title', false),
  handleInput: (input, ctx) => {
    const pick = pickLocale(input);
    if (!pick) return invalid();
    ctx.data.locale = pick.code; // survives the session; registration persists it
    ctx.locale = pick.code; // the next screen already renders in the choice
    return { next: 'welcome' };
  },
};

/** Home-menu language setting for registered farmers and drivers. */
export const langSettings: UssdScreen = {
  key: 'lang_settings',
  render: () => localeLines('ussd.lang.settings', true),
  handleInput: (input, ctx) => {
    if (input === '0') return { next: ctx.farmer ? 'home' : 'driver_home' };
    const pick = pickLocale(input);
    if (!pick) return invalid();
    if (ctx.farmer) updateFarmerProfile(ctx.farmer.id, { locale: pick.code });
    else if (ctx.driver) updateDriverProfile(ctx.driver.id, { locale: pick.code });
    ctx.data.locale = pick.code;
    ctx.locale = pick.code; // the confirmation itself speaks the NEW language
    return { end: [{ key: 'ussd.lang.done', params: { language: pick.endonym } }] };
  },
};
