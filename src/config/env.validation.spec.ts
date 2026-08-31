import { validate } from './env.validation';

describe('validate (environment variables)', () => {
  const validEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_CALLBACK_URL: 'http://localhost:3000/auth/google/callback',
    JWT_SECRET: 'test-jwt-secret',
    FRONTEND_URL: 'http://localhost:3001',
    PORT: '3000',
  };

  it('returns a validated config for a well-formed environment', () => {
    const result = validate(validEnv);

    expect(result.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(result.GOOGLE_CLIENT_ID).toBe(validEnv.GOOGLE_CLIENT_ID);
    expect(result.GOOGLE_CLIENT_SECRET).toBe(validEnv.GOOGLE_CLIENT_SECRET);
    expect(result.GOOGLE_CALLBACK_URL).toBe(validEnv.GOOGLE_CALLBACK_URL);
    expect(result.JWT_SECRET).toBe(validEnv.JWT_SECRET);
    expect(result.FRONTEND_URL).toBe(validEnv.FRONTEND_URL);
    expect(result.PORT).toBe(3000);
  });

  it('allows PORT and JWT_EXPIRES_IN to be omitted', () => {
    const { PORT: _omitPort, ...rest } = validEnv;
    const result = validate(rest);

    expect(result.PORT).toBeUndefined();
    expect(result.JWT_EXPIRES_IN).toBeUndefined();
  });

  it('accepts an explicit JWT_EXPIRES_IN', () => {
    const result = validate({ ...validEnv, JWT_EXPIRES_IN: '30d' });

    expect(result.JWT_EXPIRES_IN).toBe('30d');
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = validEnv;
    expect(() => validate(rest)).toThrow(/DATABASE_URL/);
  });

  it('throws when GOOGLE_CLIENT_ID is missing', () => {
    const { GOOGLE_CLIENT_ID: _omit, ...rest } = validEnv;
    expect(() => validate(rest)).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('throws when GOOGLE_CLIENT_SECRET is missing', () => {
    const { GOOGLE_CLIENT_SECRET: _omit, ...rest } = validEnv;
    expect(() => validate(rest)).toThrow(/GOOGLE_CLIENT_SECRET/);
  });

  it('throws when GOOGLE_CALLBACK_URL is not a valid URL', () => {
    expect(() =>
      validate({ ...validEnv, GOOGLE_CALLBACK_URL: 'not-a-url' }),
    ).toThrow(/GOOGLE_CALLBACK_URL/);
  });

  it('accepts a localhost GOOGLE_CALLBACK_URL (no TLD)', () => {
    const result = validate({
      ...validEnv,
      GOOGLE_CALLBACK_URL: 'http://localhost:3000/auth/google/callback',
    });

    expect(result.GOOGLE_CALLBACK_URL).toBe(
      'http://localhost:3000/auth/google/callback',
    );
  });

  it('throws when JWT_SECRET is missing', () => {
    const { JWT_SECRET: _omit, ...rest } = validEnv;
    expect(() => validate(rest)).toThrow(/JWT_SECRET/);
  });

  it('throws when FRONTEND_URL is not a valid URL', () => {
    expect(() => validate({ ...validEnv, FRONTEND_URL: 'not-a-url' })).toThrow(
      /FRONTEND_URL/,
    );
  });

  it('throws when PORT is not a number', () => {
    expect(() => validate({ ...validEnv, PORT: 'not-a-number' })).toThrow(
      /PORT/,
    );
  });
});
