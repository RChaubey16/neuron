import { parseList, supabaseAuthUrls } from './configuration.js';

describe('parseList', () => {
  it('splits, trims and drops empty items', () => {
    expect(parseList(' http://a.test, ,http://b.test ')).toEqual([
      'http://a.test',
      'http://b.test',
    ]);
  });

  it('returns an empty list for undefined or empty input', () => {
    expect(parseList(undefined)).toEqual([]);
    expect(parseList('')).toEqual([]);
  });
});

describe('supabaseAuthUrls', () => {
  it('derives the issuer and JWKS URL, ignoring a trailing slash', () => {
    for (const url of ['https://ref.supabase.co', 'https://ref.supabase.co/']) {
      expect(supabaseAuthUrls(url)).toEqual({
        issuer: 'https://ref.supabase.co/auth/v1',
        jwksUrl: 'https://ref.supabase.co/auth/v1/.well-known/jwks.json',
      });
    }
  });
});
