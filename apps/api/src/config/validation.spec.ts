import { NodeEnv, validate } from './validation.js';

const DATABASE_URL = 'postgresql://user:pw@localhost:5432/db';
const SUPABASE_URL = 'https://project-ref.supabase.co';
const required = { DATABASE_URL, SUPABASE_URL };

describe('validate (environment variables)', () => {
  it('applies defaults when optional variables are missing', () => {
    const env = validate(required);
    expect(env.NODE_ENV).toBe(NodeEnv.Development);
    expect(env.PORT).toBe(3000);
    expect(env.CORS_ORIGINS).toBeUndefined();
  });

  it('converts PORT from a string', () => {
    expect(validate({ ...required, PORT: '4000' }).PORT).toBe(4000);
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => validate({ ...required, PORT: '70000' })).toThrow(
      /PORT \(max\)/,
    );
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validate({ ...required, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  it('requires DATABASE_URL', () => {
    expect(() => validate({})).toThrow(/DATABASE_URL \(matches\)/);
  });

  it('rejects a DATABASE_URL that is not a postgres connection string', () => {
    expect(() => validate({ ...required, DATABASE_URL: 'mysql://x' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('requires SUPABASE_URL as an http(s) URL', () => {
    expect(() => validate({ DATABASE_URL })).toThrow(/SUPABASE_URL \(isUrl\)/);
    expect(() =>
      validate({ ...required, SUPABASE_URL: 'project-ref.supabase.co' }),
    ).toThrow(/SUPABASE_URL/);
    expect(
      validate({ ...required, SUPABASE_URL: 'http://localhost:54321' }),
    ).toBeDefined();
  });

  it('never includes variable values in the error message', () => {
    const secretLooking = 'super-secret-value';
    let message = '';
    try {
      validate({ ...required, DATABASE_URL: secretLooking });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^Invalid environment variables: DATABASE_URL/);
    expect(message).not.toContain(secretLooking);
  });
});
