import { getRequestId, runWithRequestId } from './request-context';

describe('request-context', () => {
  it('returns undefined outside of any runWithRequestId call', () => {
    expect(getRequestId()).toBeUndefined();
  });

  it('exposes the requestId to synchronous code inside the callback', () => {
    const result = runWithRequestId('req-1', () => getRequestId());

    expect(result).toBe('req-1');
  });

  it('exposes the requestId to async code inside the callback', async () => {
    const result = await runWithRequestId('req-2', async () => {
      await Promise.resolve();
      return getRequestId();
    });

    expect(result).toBe('req-2');
  });

  it('does not leak the requestId once the callback has returned', () => {
    runWithRequestId('req-3', () => undefined);

    expect(getRequestId()).toBeUndefined();
  });

  it('keeps concurrent requestIds isolated across overlapping async calls', async () => {
    const [first, second] = await Promise.all([
      runWithRequestId('req-a', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return getRequestId();
      }),
      runWithRequestId('req-b', async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return getRequestId();
      }),
    ]);

    expect(first).toBe('req-a');
    expect(second).toBe('req-b');
  });
});
