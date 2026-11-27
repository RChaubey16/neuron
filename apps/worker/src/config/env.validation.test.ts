import { describe, expect, it } from 'vitest';
import { EmailProviderName, NodeEnv, validateEnv } from './env.validation.js';

const validEnv = {
  DATABASE_URL: 'postgresql://neuron:neuron@localhost:5432/neuron',
  REDIS_URL: 'redis://localhost:6379',
};

describe('validateEnv (worker)', () => {
  it('applies defaults that point at the local Mailpit', () => {
    const env = validateEnv(validEnv);

    expect(env).toMatchObject({
      NODE_ENV: NodeEnv.Development,
      WORKER_CONCURRENCY: 5,
      WORKER_HEALTH_PORT: 4001,
      EMAIL_PROVIDER: EmailProviderName.Smtp,
      SMTP_HOST: 'localhost',
      SMTP_PORT: 1025,
      SMTP_SECURE: false,
    });
    expect(env.SMTP_USER).toBeUndefined();
  });

  it('converts numbers and booleans from strings', () => {
    const env = validateEnv({
      ...validEnv,
      WORKER_CONCURRENCY: '10',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
    });

    expect(env.WORKER_CONCURRENCY).toBe(10);
    expect(env.SMTP_PORT).toBe(465);
    expect(env.SMTP_SECURE).toBe(true);
  });

  it.each(['DATABASE_URL', 'REDIS_URL'])('requires %s', (name) => {
    const env: Record<string, unknown> = { ...validEnv };
    delete env[name];

    expect(() => validateEnv(env)).toThrow(new RegExp(name));
  });

  it.each([
    ['DATABASE_URL', 'mysql://localhost/neuron'],
    ['REDIS_URL', 'localhost:6379'],
    ['WORKER_CONCURRENCY', '0'],
    ['WORKER_CONCURRENCY', '51'],
    ['WORKER_CONCURRENCY', 'many'],
    ['EMAIL_PROVIDER', 'sendgrid'],
    ['WORKER_HEALTH_PORT', '0'],
    ['WORKER_HEALTH_PORT', 'health'],
    ['SMTP_HOST', ''],
    ['SMTP_PORT', '70000'],
    ['SMTP_SECURE', 'yes'],
  ])('rejects %s=%j', (name, value) => {
    expect(() => validateEnv({ ...validEnv, [name]: value })).toThrow(new RegExp(name));
  });

  it('requires SMTP_PASSWORD when SMTP_USER is set', () => {
    expect(() => validateEnv({ ...validEnv, SMTP_USER: 'user' })).toThrow(/SMTP_PASSWORD/);
    expect(validateEnv({ ...validEnv, SMTP_USER: 'user', SMTP_PASSWORD: 'pw' }).SMTP_USER).toBe(
      'user',
    );
  });

  describe('EMAIL_PROVIDER=resend', () => {
    const resendEnv = { ...validEnv, EMAIL_PROVIDER: 'resend' };

    it('requires RESEND_API_KEY', () => {
      expect(() => validateEnv(resendEnv)).toThrow(/RESEND_API_KEY is required/);
    });

    it('rejects a key that is not a Resend key', () => {
      expect(() => validateEnv({ ...resendEnv, RESEND_API_KEY: 'sk_live_abc' })).toThrow(
        /RESEND_API_KEY/,
      );
    });

    it('accepts a Resend key and ignores the SMTP settings', () => {
      const env = validateEnv({
        ...resendEnv,
        RESEND_API_KEY: 're_123abc',
        SMTP_HOST: '',
        SMTP_PORT: 'not-used',
      });
      expect(env.EMAIL_PROVIDER).toBe(EmailProviderName.Resend);
      expect(env.RESEND_API_KEY).toBe('re_123abc');
    });
  });

  it('does not need RESEND_API_KEY for SMTP', () => {
    expect(validateEnv(validEnv).RESEND_API_KEY).toBeUndefined();
  });
});
