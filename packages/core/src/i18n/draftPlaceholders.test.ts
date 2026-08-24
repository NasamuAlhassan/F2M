import { describe, expect, it } from 'vitest';
import { isPurePlaceholder, protectPlaceholders, restorePlaceholders } from './draftPlaceholders';

describe('draft placeholder protection (M30, D-040)', () => {
  it('round-trips the five-param stress case (sms.graded)', () => {
    const template =
      'Farm to Market: Your {commodity} graded {band}, pays {amount}. Reason: {reason}. Dial {code}, My lots, to agree or dispute.';
    const { masked, tokens } = protectPlaceholders(template);
    expect(tokens).toHaveLength(5);
    expect(masked).not.toContain('{');
    expect(restorePlaceholders(masked, tokens)).toBe(template);
  });

  it('survives MT reordering the sentinels', () => {
    const { tokens } = protectPlaceholders('{kg}kg of {commodity}');
    // A translator may say "commodity, kg-many" — order changes, sentinels survive.
    const translated = `aduane 70902 no, kilo 70901`;
    expect(restorePlaceholders(translated, tokens)).toBe('aduane {commodity} no, kilo {kg}');
  });

  it('rejects a translation that loses or duplicates a sentinel', () => {
    const { tokens } = protectPlaceholders('{kg}kg at {price}');
    expect(restorePlaceholders('kilo dodow no', tokens)).toBeNull(); // both lost
    expect(restorePlaceholders('70901 ne 70901 / 70902', tokens)).toBeNull(); // duplicated
  });

  it('the alternate sentinel family produces different sentinels', () => {
    const a = protectPlaceholders('{x} {y}', 0);
    const b = protectPlaceholders('{x} {y}', 1);
    expect(a.tokens.map((t) => t.sentinel)).toEqual(['70901', '70902']);
    expect(b.tokens.map((t) => t.sentinel)).toEqual(['84101', '84102']);
  });

  it('repeated params each get their own sentinel and restore', () => {
    const template = '{code} then {code}';
    const { masked, tokens } = protectPlaceholders(template);
    expect(tokens).toHaveLength(2);
    expect(restorePlaceholders(masked, tokens)).toBe(template);
  });

  it('detects pure-placeholder templates', () => {
    expect(isPurePlaceholder('{n}. {label}')).toBe(true);
    expect(isPurePlaceholder('{kg}kg')).toBe(false);
    expect(isPurePlaceholder('GHS {amount}')).toBe(false);
  });
});
