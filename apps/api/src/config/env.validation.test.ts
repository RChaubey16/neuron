import { describe, expect, it } from 'vitest';
import { NodeEnv, parseEmailList, validateEnv } from './env.validation.js';

const validEnv = {
  DATABASE_URL: 'postgresql://neuron:neuron@localhost:5432/neuron',
  REDIS_URL: 'redis://localhost:6379',
  EMAIL_FROM: 'Neuron <noreply@example.com>',
  WEB_URL: 'http://localhost:3000',
  GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:4000/auth/google/callback',
  SESSION_SECRET: 'x'.repeat(32),
  ALLOWED_EMAILS: 'me@example.com',
};

describe('validateEnv', () => {
  it('accepts a complete environment and applies defaults', () => {
    const env = validateEnv(validEnv);

    expect(env.NODE_ENV).toBe(NodeEnv.Development);
    expect(env.API_PORT).toBe(4000);
    expect(env.COOKIE_DOMAIN).toBeUndefined();
  });

  it('converts API_PORT from a string to a number', () => {
    const env = validateEnv({ ...validEnv, API_PORT: '8080', NODE_ENV: 'production' });

    expect(env.API_PORT).toBe(8080);
    expect(env.NODE_ENV).toBe(NodeEnv.Production);
  });

  it.each(['abc', '0', '65536', '-1', '4000.5', ''])('rejects API_PORT=%j', (port) => {
    expect(() => validateEnv({ ...validEnv, API_PORT: port })).toThrow(/API_PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it.each([
    'DATABASE_URL',
    'REDIS_URL',
    'EMAIL_FROM',
    'WEB_URL',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_CALLBACK_URL',
    'SESSION_SECRET',
    'ALLOWED_EMAILS',
  ])('requires %s', (name) => {
    const env: Record<string, unknown> = { ...validEnv };
    delete env[name];

    expect(() => validateEnv(env)).toThrow(new RegExp(name));
  });

  it.each([
    ['DATABASE_URL', 'mysql://localhost/neuron'],
    ['REDIS_URL', 'localhost:6379'],
    ['REDIS_URL', 'http://localhost:6379'],
    ['EMAIL_FROM', 'not-an-email'],
    ['EMAIL_FROM', 'Neuron <not-an-email>'],
    ['WEB_URL', 'localhost:3000'],
    ['WEB_URL', 'ftp://example.com'],
    ['GOOGLE_CALLBACK_URL', 'not a url'],
    ['SESSION_SECRET', 'too-short'],
    ['ALLOWED_EMAILS', ''],
    ['ALLOWED_EMAILS', ' , '],
    ['ALLOWED_EMAILS', 'me@example.com, not-an-email'],
    ['COOKIE_DOMAIN', 'https://example.com'],
  ])('rejects %s=%j', (name, value) => {
    expect(() => validateEnv({ ...validEnv, [name]: value })).toThrow(new RegExp(name));
  });

  it('parses ALLOWED_EMAILS into a trimmed, lowercase list', () => {
    const env = validateEnv({ ...validEnv, ALLOWED_EMAILS: ' Me@Example.com ,you@example.com,' });

    expect(env.ALLOWED_EMAILS).toEqual(['me@example.com', 'you@example.com']);
  });

  it.each(['redis://localhost:6379', 'redis://:secret@redis:6379/2', 'rediss://user:pw@host:6380'])(
    'accepts REDIS_URL=%j',
    (url) => {
      expect(validateEnv({ ...validEnv, REDIS_URL: url }).REDIS_URL).toBe(url);
    },
  );

  it('accepts a bare EMAIL_FROM address', () => {
    expect(validateEnv({ ...validEnv, EMAIL_FROM: 'noreply@example.com' }).EMAIL_FROM).toBe(
      'noreply@example.com',
    );
  });

  it('accepts a COOKIE_DOMAIN with a leading dot', () => {
    expect(validateEnv({ ...validEnv, COOKIE_DOMAIN: '.neuron.example.com' }).COOKIE_DOMAIN).toBe(
      '.neuron.example.com',
    );
  });

  it('lists every invalid variable in one error', () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: 'staging', API_PORT: 'abc' })).toThrow(
      /NODE_ENV[\s\S]*API_PORT|API_PORT[\s\S]*NODE_ENV/,
    );
  });
});

describe('parseEmailList', () => {
  it('leaves non-strings alone for the validator to reject', () => {
    expect(parseEmailList(undefined)).toBeUndefined();
    expect(parseEmailList(42)).toBe(42);
  });
});
