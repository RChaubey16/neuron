'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Blocks,
  KeyRound,
  LineChart,
  Link2,
  LogOut,
  Mail,
  Menu,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react';

// Grouped into the two sections the dashboard is organized around: using a
// service directly vs. managing machine access to it. `Routes` (formerly
// labeled "Services") lives under API now that "Services" names the group
// of usable-in-browser services instead.
const NAV_GROUPS = [
  {
    label: 'Services',
    items: [
      { href: '/dashboard/urls', label: 'URLs', icon: Link2 },
      { href: '/dashboard/notifications', label: 'Notifications', icon: Mail },
    ],
  },
  {
    label: 'API',
    items: [
      { href: '/dashboard', label: 'Keys', icon: KeyRound },
      { href: '/dashboard/usage', label: 'Usage', icon: LineChart },
      { href: '/dashboard/services', label: 'Routes', icon: Blocks },
    ],
  },
] as const;

const SETTINGS_ITEM = {
  href: '/dashboard/settings',
  label: 'Settings',
  icon: Settings,
} as const;

function useActivePath() {
  const pathname = usePathname();
  return (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-4 py-4">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent font-display text-sm font-bold text-white">
        N
      </span>
      <span className="font-display text-[15px] font-semibold tracking-tight text-fg">
        Neuron
      </span>
    </Link>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={`flex items-center gap-2.5 border-l-2 py-2 pr-4 pl-[14px] text-[13px] font-medium ${
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-transparent text-fg-2 hover:border-border-strong hover:text-fg'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function NavLinks({
  isActive,
  onNavigate,
}: {
  isActive: (href: string) => boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-1 flex-col overflow-y-auto py-2">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5 py-2 first:pt-0">
          <span className="px-4 pb-1 text-[11px] font-semibold tracking-wide text-fg-3">
            {group.label.toUpperCase()}
          </span>
          {group.items.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={isActive(item.href)}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
      <div className="mt-auto flex flex-col gap-0.5 border-t border-border pt-2">
        <NavLink
          href={SETTINGS_ITEM.href}
          label={SETTINGS_ITEM.label}
          icon={SETTINGS_ITEM.icon}
          active={isActive(SETTINGS_ITEM.href)}
          onNavigate={onNavigate}
        />
      </div>
    </nav>
  );
}

function UserRow({
  userEmail,
  onSignOut,
}: {
  userEmail: string | undefined;
  onSignOut: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3.5">
      {userEmail ? (
        <span className="flex min-w-0 items-center gap-2 text-[13px] text-fg-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-medium text-fg-2">
            {userEmail.charAt(0).toUpperCase()}
          </span>
          <span className="truncate">{userEmail}</span>
        </span>
      ) : (
        <span />
      )}
      <button
        onClick={onSignOut}
        className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-fg-3 hover:text-fg"
      >
        <LogOut className="h-3.5 w-3.5" />
        Sign out
      </button>
    </div>
  );
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

  // Lets a keyboard/mouse user dismiss the drawer without hunting for the
  // toggle button again, matching standard overlay-dismissal expectations.
  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  return (
    <>
      {/* Desktop sidebar — always mounted; only hidden below `lg` via CSS, so
          test can rely on it being present in the DOM regardless of viewport
          (jsdom doesn't apply the Tailwind stylesheet). */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-10 lg:flex lg:w-60 lg:flex-col lg:border-r lg:border-border lg:bg-surface">
        <Brand />
        <NavLinks isActive={isActive} />
        <UserRow userEmail={userEmail} onSignOut={onSignOut} />
      </aside>

      {/* Mobile/tablet top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4 lg:hidden">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent font-display text-xs font-bold text-white">
            N
          </span>
          <span className="font-display text-sm font-semibold text-fg">
            Neuron
          </span>
        </Link>
        <button
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          className="flex h-8 w-8 items-center justify-center rounded-md text-fg-2 hover:text-fg"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-20 lg:hidden">
          <div
            aria-hidden="true"
            onClick={() => setMenuOpen(false)}
            className="absolute inset-0 bg-black/30"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="absolute inset-y-0 left-0 flex w-64 max-w-[80vw] flex-col border-r border-border bg-surface"
          >
            <Brand />
            <NavLinks isActive={isActive} onNavigate={() => setMenuOpen(false)} />
            <UserRow userEmail={userEmail} onSignOut={onSignOut} />
          </div>
        </div>
      )}
    </>
  );
}
