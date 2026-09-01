import { describe, expect, it } from 'vitest';
import { parseTokenFromHash } from './parse-token-from-hash';

describe('parseTokenFromHash', () => {
  it('extracts the token from a bare hash', () => {
    expect(parseTokenFromHash('#token=abc123')).toBe('abc123');
  });

  it('extracts the token alongside other params', () => {
    expect(parseTokenFromHash('#foo=bar&token=abc123&baz=qux')).toBe(
      'abc123',
    );
  });

  it('returns null when there is no token param', () => {
    expect(parseTokenFromHash('#foo=bar')).toBeNull();
  });

  it('returns null for an empty hash', () => {
    expect(parseTokenFromHash('')).toBeNull();
  });

  it('handles a hash without the leading #', () => {
    expect(parseTokenFromHash('token=abc123')).toBe('abc123');
  });
});
