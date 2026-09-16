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
    <div className="flex min-h-full flex-1 flex-col lg:flex-row">
      <DashboardNav userEmail={user?.email} onSignOut={signOut} />
      <main className="w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:ml-60 lg:px-10 lg:py-10">
        {children}
      </main>
    </div>
  );
}
