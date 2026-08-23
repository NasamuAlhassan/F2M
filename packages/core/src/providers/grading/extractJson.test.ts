import { describe, expect, it } from 'vitest';
import { extractJson } from './extractJson';

describe('extractJson', () => {
  it('parses a bare JSON object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips code fences', () => {
    expect(extractJson('```json\n{"gradeBand":"B"}\n```')).toEqual({ gradeBand: 'B' });
  });

  it('ignores surrounding prose and trailing text', () => {
    expect(extractJson('Here is my assessment:\n{"a":{"b":2}}\nHope that helps!')).toEqual({ a: { b: 2 } });
  });

  it('handles braces inside strings', () => {
    expect(extractJson('{"observation":"mould {spots} on ~10%"}')).toEqual({ observation: 'mould {spots} on ~10%' });
  });

  it('throws on no object or unbalanced braces', () => {
    expect(() => extractJson('no json here')).toThrow();
    expect(() => extractJson('{"a": {"b": 1}')).toThrow();
  });
});
