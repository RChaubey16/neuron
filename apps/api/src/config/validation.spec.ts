import { NodeEnv, validate } from './validation.js';

describe('validate (environment variables)', () => {
  it('applies defaults when optional variables are missing', () => {
    const env = validate({});
    expect(env.NODE_ENV).toBe(NodeEnv.Development);
    expect(env.PORT).toBe(3000);
    expect(env.CORS_ORIGINS).toBeUndefined();
  });

  it('converts PORT from a string', () => {
    expect(validate({ PORT: '4000' }).PORT).toBe(4000);
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => validate({ PORT: '70000' })).toThrow(/PORT \(max\)/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validate({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('never includes variable values in the error message', () => {
    const secretLooking = 'super-secret-value';
    let message = '';
    try {
      validate({ NODE_ENV: secretLooking });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^Invalid environment variables: NODE_ENV/);
    expect(message).not.toContain(secretLooking);
  });
});
