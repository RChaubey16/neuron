'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Gauge, GitBranch, Timer, UserRound, type LucideIcon } from 'lucide-react';

function SettingsRow({
  icon: Icon,
  label,
  hint,
  value,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-fg-3" />
        <div>
          <p className="text-sm font-medium text-fg">{label}</p>
          <p className="text-xs text-fg-3">{hint}</p>
        </div>
      </div>
      <span className="font-mono text-sm text-fg-2">{value}</span>
    </div>
  );
}

export default function SettingsPage() {
  const { data: user } = useQuery({ queryKey: ['me'], queryFn: api.getMe });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-[22px] font-semibold tracking-tight text-fg">
          Settings
        </h1>
        <p className="mt-1 text-sm text-fg-2">
          Account and API reference info.
        </p>
      </div>

      <div className="max-w-2xl divide-y divide-border rounded-xl border border-border bg-surface">
        <SettingsRow
          icon={UserRound}
          label="Signed in as"
          hint="Google account, cannot be changed here"
          value={user?.email ?? '—'}
        />
        <SettingsRow
          icon={GitBranch}
          label="Default API version"
          hint="Prefix used by every service route"
          value="v1"
        />
        <SettingsRow
          icon={Gauge}
          label="Rate limit — create/resolve short links"
          hint="POST /api/v1/short-url/shorten, per IP"
          value="10 req/min"
        />
        <SettingsRow
          icon={Timer}
          label="Rate limit — short-link redirects"
          hint="GET /:code, per IP"
          value="60 req/min"
        />
      </div>
    </div>
  );
}
