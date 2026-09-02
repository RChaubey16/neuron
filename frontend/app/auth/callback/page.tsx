'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setToken } from '@/lib/auth-token';
import { parseTokenFromHash } from '@/lib/parse-token-from-hash';
import { useClientOnlyValue } from '@/lib/use-client-only-value';

function getHashToken(): string | null {
  return parseTokenFromHash(window.location.hash);
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const token = useClientOnlyValue<string | null>(getHashToken, null);

  useEffect(() => {
    if (!token) return;
    setToken(token);
    // Strip the token from the URL/history before navigating away.
    window.history.replaceState(null, '', window.location.pathname);
    router.replace('/dashboard');
  }, [token, router]);

  if (token === null) {
    return (
      <div className="flex flex-1 items-center justify-center bg-canvas">
        <p className="text-sm text-danger">
          Sign-in failed — no token received.{' '}
          <Link href="/" className="text-accent underline">
            Try again
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-canvas">
      <p className="text-sm text-fg-2">Signing you in…</p>
    </div>
  );
}
