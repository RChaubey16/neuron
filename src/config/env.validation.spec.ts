import { validate } from './env.validation';

describe('validate (environment variables)', () => {
  const validEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    SUPABASE_URL: 'https://project.supabase.co',
    PORT: '3000',
  };

  it('returns a validated config for a well-formed environment', () => {
    const result = validate(validEnv);

    expect(result.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(result.SUPABASE_URL).toBe(validEnv.SUPABASE_URL);
    expect(result.PORT).toBe(3000);
  });

  it('allows PORT to be omitted', () => {
    const result = validate({
      DATABASE_URL: validEnv.DATABASE_URL,
      SUPABASE_URL: validEnv.SUPABASE_URL,
    });

    expect(result.PORT).toBeUndefined();
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() =>
      validate({ SUPABASE_URL: validEnv.SUPABASE_URL, PORT: validEnv.PORT }),
    ).toThrow(/DATABASE_URL/);
  });

  it('throws when SUPABASE_URL is missing', () => {
    expect(() =>
      validate({ DATABASE_URL: validEnv.DATABASE_URL, PORT: validEnv.PORT }),
    ).toThrow(/SUPABASE_URL/);
  });

  it('throws when SUPABASE_URL is not a valid URL', () => {
    expect(() => validate({ ...validEnv, SUPABASE_URL: 'not-a-url' })).toThrow(
      /SUPABASE_URL/,
    );
  });

  it('throws when PORT is not a number', () => {
    expect(() => validate({ ...validEnv, PORT: 'not-a-number' })).toThrow(
      /PORT/,
    );
  });
});
