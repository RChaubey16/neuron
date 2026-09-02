'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth-token';
import { googleSignInUrl } from '@/lib/api';
import { useClientOnlyValue } from '@/lib/use-client-only-value';

export default function Home() {
  const router = useRouter();
  const token = useClientOnlyValue<string | null>(getToken, null);

  useEffect(() => {
    if (token) router.replace('/dashboard');
  }, [token, router]);

  if (token) return null;

  return (
    <div className="flex flex-1 items-center justify-center bg-canvas px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border border-border bg-surface p-10 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent font-display text-base font-bold text-white">
          N
        </span>
        <div>
          <h1 className="font-display text-2xl font-semibold text-fg">
            Neuron
          </h1>
          <p className="mt-2 text-sm text-fg-2">
            Sign in to manage your API keys and view usage.
          </p>
        </div>
        <a
          href={googleSignInUrl()}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white shadow-[inset_0_-1px_0_rgba(16,24,40,0.15)] hover:bg-accent-hover"
        >
          Sign in with Google
        </a>
      </div>
    </div>
  );
}
