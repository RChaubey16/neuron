import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimeoutError, withTimeout } from './with-timeout.js';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'answer')).resolves.toBe(42);
  });

  it('passes on the original rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'x')).rejects.toThrow('boom');
  });

  it('rejects with a TimeoutError naming the operation when it takes too long', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => undefined), 500, 'Adding the job');

    const assertion = expect(pending).rejects.toThrow(
      new TimeoutError('Adding the job timed out after 500ms'),
    );
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it('clears its timer once the promise settles', async () => {
    vi.useFakeTimers();

    await withTimeout(Promise.resolve('done'), 500, 'x');

    expect(vi.getTimerCount()).toBe(0);
  });
});
