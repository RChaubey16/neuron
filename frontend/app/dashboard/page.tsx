'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthGuard } from '@/lib/use-auth-guard';
import { clearToken } from '@/lib/auth-token';
import { ApiKeysSection } from './api-keys-section';
import { UsageSection } from './usage-section';

export default function DashboardPage() {
  const ready = useAuthGuard();
  const { data: user } = useQuery({
    queryKey: ['me'],
    queryFn: api.getMe,
    enabled: ready,
  });

  if (!ready) return null;

  function signOut() {
    clearToken();
    window.location.href = '/';
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Neuron Dashboard
          </h1>
          {user && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {user.email}
            </p>
          )}
        </div>
        <button
          onClick={signOut}
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50"
        >
          Sign out
        </button>
      </header>

      <ApiKeysSection />
      <UsageSection />
    </div>
  );
}
