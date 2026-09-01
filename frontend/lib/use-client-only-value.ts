'use client';

import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

/**
 * Reads a client-only value (localStorage, location.hash) without a hydration
 * mismatch: renders `serverValue` for the prerendered output and the first
 * hydration pass, then React automatically re-renders with the real client value.
 */
export function useClientOnlyValue<T>(
  getClientValue: () => T,
  serverValue: T,
): T {
  return useSyncExternalStore(noopSubscribe, getClientValue, () => serverValue);
}
