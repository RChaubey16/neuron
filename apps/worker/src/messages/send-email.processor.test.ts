import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { describeError } from './message-sender.service.js';
import { parseJobData } from './send-email.processor.js';

describe('parseJobData', () => {
  it('accepts a message ID that is a UUID', () => {
    const messageId = '01a21263-cdd8-77cd-85c2-ccfbbb92bbef';

    expect(parseJobData({ messageId })).toEqual({ messageId });
  });

  it('drops any extra fields', () => {
    const messageId = '01a21263-cdd8-77cd-85c2-ccfbbb92bbef';

    expect(parseJobData({ messageId, extra: true })).toEqual({ messageId });
  });

  it.each([
    ['null', null],
    ['a string', 'id'],
    ['no messageId', {}],
    ['a numeric messageId', { messageId: 1 }],
    ['a messageId that is not a UUID', { messageId: 'abc' }],
  ])('rejects %s as unrecoverable', (_label, data) => {
    expect(() => parseJobData(data)).toThrow(UnrecoverableError);
  });
});

describe('describeError', () => {
  it('includes the error name and message', () => {
    expect(describeError(new TypeError('bad'))).toBe('TypeError: bad');
  });

  it('handles values that are not errors', () => {
    expect(describeError('plain')).toBe('plain');
  });

  it('caps very long errors at 1000 characters', () => {
    const described = describeError(new Error('x'.repeat(5000)));

    expect(described).toHaveLength(1000);
    expect(described.endsWith('…')).toBe(true);
  });
});
