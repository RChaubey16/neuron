import { describe, expect, it } from 'vitest';
import {
  MESSAGE_STATUSES,
  canTransitionMessageStatus,
  isMessageStatus,
  isTerminalMessageStatus,
} from './message-status.js';

describe('isMessageStatus', () => {
  it.each(MESSAGE_STATUSES)('accepts %s', (status) => {
    expect(isMessageStatus(status)).toBe(true);
  });

  it.each(['delivered', 'QUEUED', '', ' sent', null, undefined, 1, {}, ['sent']])(
    'rejects %j',
    (value) => {
      expect(isMessageStatus(value)).toBe(false);
    },
  );
});

describe('isTerminalMessageStatus', () => {
  it('treats sent and failed as terminal', () => {
    expect(isTerminalMessageStatus('sent')).toBe(true);
    expect(isTerminalMessageStatus('failed')).toBe(true);
  });

  it('treats queued and sending as non-terminal', () => {
    expect(isTerminalMessageStatus('queued')).toBe(false);
    expect(isTerminalMessageStatus('sending')).toBe(false);
  });
});

describe('canTransitionMessageStatus', () => {
  it.each([
    ['queued', 'sending'],
    ['queued', 'failed'],
    ['sending', 'sent'],
    ['sending', 'failed'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransitionMessageStatus(from, to)).toBe(true);
  });

  it.each([
    ['queued', 'queued'],
    ['queued', 'sent'],
    ['sending', 'queued'],
    ['sending', 'sending'],
    ['sent', 'failed'],
    ['sent', 'sending'],
    ['failed', 'queued'],
    ['failed', 'sent'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(canTransitionMessageStatus(from, to)).toBe(false);
  });

  it('never allows leaving a terminal status', () => {
    for (const from of MESSAGE_STATUSES.filter(isTerminalMessageStatus)) {
      for (const to of MESSAGE_STATUSES) {
        expect(canTransitionMessageStatus(from, to)).toBe(false);
      }
    }
  });
});
