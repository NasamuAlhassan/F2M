import { afterEach, describe, expect, it } from 'vitest';
import { isLocaleLive, isLocaleReviewed, liveLocales, setDraftLocalesLive, speechLocale, t, tDraft } from './index';

// The review gate (D-040): machine-drafted catalogs resolve to English on
// every real surface until reviewed — or until the owner's draft-live escape
// hatch is on. tDraft is the preview channel and ignores the gate.
describe('i18n review gate', () => {
  afterEach(() => setDraftLocalesLive(null));

  it('t() resolves an unreviewed draft locale entirely from English', () => {
    expect(t('tw', 'commodity.MAIZE')).toBe('Maize');
    expect(t('tw', 'sms.newOffer', { kg: 500, commodity: 'Maize', price: 'GHS 4.55', code: '*384#' })).toContain('New offer');
  });

  it('tDraft() serves the draft text regardless of the gate', () => {
    expect(tDraft('tw', 'commodity.MAIZE')).toBe('Aburo');
  });

  it('setDraftLocalesLive(true) opens t() to drafts', () => {
    setDraftLocalesLive(true);
    expect(t('tw', 'commodity.MAIZE')).toBe('Aburo');
    setDraftLocalesLive(null);
    expect(t('tw', 'commodity.MAIZE')).toBe('Maize');
  });

  it('per-key English fallback still applies inside a live draft catalog', () => {
    setDraftLocalesLive(true);
    // tw has no ussd.home.sell — falls back to English, never the raw key.
    expect(t('tw', 'ussd.home.sell')).toBe('1. Sell produce');
  });

  it('liveLocales() is English-only by default and grows under draft-live', () => {
    expect(liveLocales().map((l) => l.code)).toEqual(['en']);
    setDraftLocalesLive(true);
    expect(liveLocales().map((l) => l.code)).toEqual(['en', 'tw', 'ee', 'dag', 'ha', 'kus']);
  });

  it('reviewed and live flags: en is always both; drafts are neither by default', () => {
    expect(isLocaleReviewed('en')).toBe(true);
    expect(isLocaleReviewed('tw')).toBe(false);
    expect(isLocaleLive('tw')).toBe(false);
    expect(isLocaleLive('xx')).toBe(false);
    setDraftLocalesLive(true);
    expect(isLocaleLive('tw')).toBe(true);
    expect(isLocaleLive('xx')).toBe(false); // no catalog, never live
  });

  it('speechLocale never puts English words in a local voice', () => {
    expect(speechLocale('tw')).toBe('en');
    setDraftLocalesLive(true);
    expect(speechLocale('tw')).toBe('tw');
    expect(speechLocale('en')).toBe('en');
  });

  it('missing key falls back to the key itself; params interpolate', () => {
    expect(t('en', 'no.such.key')).toBe('no.such.key');
    expect(t('en', 'ussd.lang.done', { language: 'Twi' })).toBe('Language updated to Twi. Your SMS and calls will use it.');
    expect(t('en', 'sms.registered', { name: 'Adwoa' })).toContain('Welcome Adwoa!');
  });
});
