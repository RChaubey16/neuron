import { describe, expect, it } from 'vitest';
import { NodeEnv, validateEnv } from './env.validation.js';

describe('validateEnv', () => {
  it('applies defaults when variables are missing', () => {
    const env = validateEnv({});

    expect(env.NODE_ENV).toBe(NodeEnv.Development);
    expect(env.API_PORT).toBe(4000);
  });

  it('converts API_PORT from a string to a number', () => {
    const env = validateEnv({ API_PORT: '8080', NODE_ENV: 'production' });

    expect(env.API_PORT).toBe(8080);
    expect(env.NODE_ENV).toBe(NodeEnv.Production);
  });

  it.each(['abc', '0', '65536', '-1', '4000.5', ''])('rejects API_PORT=%j', (port) => {
    expect(() => validateEnv({ API_PORT: port })).toThrow(/API_PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('lists every invalid variable in one error', () => {
    expect(() => validateEnv({ NODE_ENV: 'staging', API_PORT: 'abc' })).toThrow(
      /NODE_ENV[\s\S]*API_PORT|API_PORT[\s\S]*NODE_ENV/,
    );
  });
});
