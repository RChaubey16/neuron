'use client';

import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthGuard } from '@/lib/use-auth-guard';
import { clearToken } from '@/lib/auth-token';
import { DashboardNav } from './dashboard-nav';

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
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
    <div className="flex min-h-full flex-1 flex-col">
      <DashboardNav userEmail={user?.email} onSignOut={signOut} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        {children}
      </main>
    </div>
  );
}
