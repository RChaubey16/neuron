import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  API_KEY_PREFIX,
  DISPLAY_PREFIX_LENGTH,
  generateApiKey,
  hashApiKey,
  isWellFormedApiKey,
} from './api-key.js';

describe('generateApiKey', () => {
  it('creates a well-formed key with the nrn_ prefix', () => {
    const { key } = generateApiKey();

    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key).toHaveLength(API_KEY_PREFIX.length + 43);
    expect(isWellFormedApiKey(key)).toBe(true);
  });

  it('returns the display prefix and the hash of the key', () => {
    const { key, prefix, hash } = generateApiKey();

    expect(prefix).toBe(key.slice(0, DISPLAY_PREFIX_LENGTH));
    expect(hash).toBe(hashApiKey(key));
  });

  it('never repeats a key', () => {
    const keys = new Set(Array.from({ length: 1000 }, () => generateApiKey().key));

    expect(keys.size).toBe(1000);
  });
});

describe('hashApiKey', () => {
  it('is hex SHA-256 of the key', () => {
    expect(hashApiKey('nrn_test')).toBe(createHash('sha256').update('nrn_test').digest('hex'));
    expect(hashApiKey('nrn_test')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('isWellFormedApiKey', () => {
  const valid = `nrn_${'a'.repeat(43)}`;

  it('accepts the expected format', () => {
    expect(isWellFormedApiKey(valid)).toBe(true);
    expect(isWellFormedApiKey(`nrn_${'A1_-'.repeat(10)}abc`)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['wrong prefix', `key_${'a'.repeat(43)}`],
    ['too short', `nrn_${'a'.repeat(42)}`],
    ['too long', `nrn_${'a'.repeat(44)}`],
    ['invalid characters', `nrn_${'a'.repeat(42)}=`],
    ['whitespace', ` ${valid}`],
  ])('rejects %s', (_label, value) => {
    expect(isWellFormedApiKey(value)).toBe(false);
  });
});
