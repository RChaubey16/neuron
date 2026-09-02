'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Blocks, KeyRound, LineChart, LogOut, Settings } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Keys', icon: KeyRound },
  { href: '/dashboard/usage', label: 'Usage', icon: LineChart },
  { href: '/dashboard/services', label: 'Services', icon: Blocks },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
] as const;

export function DashboardNav({
  userEmail,
  onSignOut,
}: {
  userEmail: string | undefined;
  onSignOut: () => void;
}) {
  const pathname = usePathname();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
      <div className="flex items-center gap-8">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-xs font-bold text-white">
            N
          </span>
          <span className="font-display text-sm font-semibold text-fg">
            Neuron
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium ${
                  active
                    ? 'bg-accent-soft text-accent'
                    : 'text-fg-2 hover:text-fg'
                }`}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        {userEmail && (
          <span className="flex items-center gap-2 text-[13px] text-fg-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-2 text-[11px] font-medium text-fg-2">
              {userEmail.charAt(0).toUpperCase()}
            </span>
            {userEmail}
          </span>
        )}
        <button
          onClick={onSignOut}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[13px] text-fg-2 hover:text-fg"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </button>
      </div>
    </header>
  );
}
