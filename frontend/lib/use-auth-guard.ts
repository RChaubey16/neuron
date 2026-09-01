'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from './auth-token';
import { useClientOnlyValue } from './use-client-only-value';

const UNDETERMINED = Symbol('undetermined');

/** Redirects to `/` if no token is stored. Returns true once the check has passed. */
export function useAuthGuard(): boolean {
  const router = useRouter();
  const token = useClientOnlyValue<string | null | typeof UNDETERMINED>(
    getToken,
    UNDETERMINED,
  );

  useEffect(() => {
    if (token === null) router.replace('/');
  }, [token, router]);

  return token !== UNDETERMINED && token !== null;
}
