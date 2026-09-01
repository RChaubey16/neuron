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
    <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-black">
      <div className="flex flex-col items-center gap-6 rounded-2xl bg-white p-10 text-center shadow-sm dark:bg-zinc-900">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
          Neuron
        </h1>
        <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-400">
          Sign in to manage your API keys and view usage.
        </p>
        <a
          href={googleSignInUrl()}
          className="flex items-center gap-2 rounded-full bg-zinc-900 px-6 py-3 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          Sign in with Google
        </a>
      </div>
    </div>
  );
}
