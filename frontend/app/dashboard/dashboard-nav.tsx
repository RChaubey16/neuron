'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Blocks,
  KeyRound,
  LineChart,
  LogOut,
  Menu,
  Settings,
  X,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Keys', icon: KeyRound },
  { href: '/dashboard/usage', label: 'Usage', icon: LineChart },
  { href: '/dashboard/services', label: 'Services', icon: Blocks },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
] as const;

function useActivePath() {
  const pathname = usePathname();
  return (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);
}

export function DashboardNav({
  userEmail,
  onSignOut,
}: {
  userEmail: string | undefined;
  onSignOut: () => void;
}) {
  const isActive = useActivePath();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="relative shrink-0 border-b border-border bg-surface">
      <div className="flex h-14 items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-xs font-bold text-white">
              N
            </span>
            <span className="font-display text-sm font-semibold text-fg">
              Neuron
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium ${
                  isActive(item.href)
                    ? 'bg-accent-soft text-accent'
                    : 'text-fg-2 hover:text-fg'
                }`}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="hidden items-center gap-3 md:flex">
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

        <button
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          className="flex h-8 w-8 items-center justify-center rounded-md text-fg-2 hover:text-fg md:hidden"
        >
          {menuOpen ? (
            <X className="h-5 w-5" />
          ) : (
            <Menu className="h-5 w-5" />
          )}
        </button>
      </div>

      {menuOpen && (
        <div className="border-t border-border bg-surface px-4 pb-4 md:hidden">
          <nav className="flex flex-col gap-1 pt-3">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? 'page' : undefined}
                onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                  isActive(item.href)
                    ? 'bg-accent-soft text-accent'
                    : 'text-fg-2 hover:text-fg'
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
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
        </div>
      )}
    </header>
  );
}
