import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestContextStore {
  requestId: string;
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContextStore>();

/**
 * Runs `callback` with `requestId` available to any code on the same async
 * call stack via `getRequestId()`. Used by `RequestIdMiddleware` so the
 * structured logger and the global exception filter can tag their output
 * with the current request's correlation ID without it being threaded
 * through every function signature in between.
 */
export function runWithRequestId<T>(requestId: string, callback: () => T): T {
  return asyncLocalStorage.run({ requestId }, callback);
}

/**
 * Returns the current request's correlation ID, or `undefined` when called
 * outside of a request (e.g. during app bootstrap).
 */
export function getRequestId(): string | undefined {
  return asyncLocalStorage.getStore()?.requestId;
}
