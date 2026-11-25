export class TimeoutError extends Error {
  override readonly name = 'TimeoutError';
}

/**
 * Rejects with a TimeoutError if the promise hasn't settled within `ms`. The
 * original promise keeps running; this only stops the caller waiting for it.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${what} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
