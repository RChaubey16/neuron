import { NodeEnv, validate } from './validation.js';

const DATABASE_URL = 'postgresql://user:pw@localhost:5432/db';

describe('validate (environment variables)', () => {
  it('applies defaults when optional variables are missing', () => {
    const env = validate({ DATABASE_URL });
    expect(env.NODE_ENV).toBe(NodeEnv.Development);
    expect(env.PORT).toBe(3000);
    expect(env.CORS_ORIGINS).toBeUndefined();
  });

  it('converts PORT from a string', () => {
    expect(validate({ DATABASE_URL, PORT: '4000' }).PORT).toBe(4000);
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => validate({ DATABASE_URL, PORT: '70000' })).toThrow(
      /PORT \(max\)/,
    );
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validate({ DATABASE_URL, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  it('requires DATABASE_URL', () => {
    expect(() => validate({})).toThrow(/DATABASE_URL \(matches\)/);
  });

  it('rejects a DATABASE_URL that is not a postgres connection string', () => {
    expect(() => validate({ DATABASE_URL: 'mysql://x' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('never includes variable values in the error message', () => {
    const secretLooking = 'super-secret-value';
    let message = '';
    try {
      validate({ DATABASE_URL: secretLooking });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^Invalid environment variables: DATABASE_URL/);
    expect(message).not.toContain(secretLooking);
  });
});
