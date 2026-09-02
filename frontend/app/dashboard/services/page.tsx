import { Bell, Link2, type LucideIcon } from 'lucide-react';

interface ServiceInfo {
  name: string;
  description: string;
  method: string;
  path: string;
  status: 'Generally available' | 'Planned';
  icon: LucideIcon;
}

// Mirrors the actual state of src/ — only list a service once its module exists.
const SERVICES: ServiceInfo[] = [
  {
    name: 'URL shortener',
    description: 'Create, resolve and expire short links. Click counts included.',
    method: 'POST',
    path: '/api/v1/short-url/shorten',
    status: 'Generally available',
    icon: Link2,
  },
  {
    name: 'Notifications',
    description: 'Email and webhook delivery with retries and per-channel templates.',
    method: '—',
    path: 'Not yet available',
    status: 'Planned',
    icon: Bell,
  },
];

function StatusBadge({ status }: { status: ServiceInfo['status'] }) {
  if (status === 'Generally available') {
    return (
      <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success">
        Generally available
      </span>
    );
  }
  return (
    <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-fg-3">
      Planned
    </span>
  );
}

export default function ServicesPage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-[22px] font-semibold tracking-tight text-fg">
          Services
        </h1>
        <p className="mt-1 text-sm text-fg-2">
          Everything reachable behind your keys. Per-service settings land
          here next.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SERVICES.map((service) => (
          <div
            key={service.name}
            className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <service.icon className="h-[18px] w-[18px]" />
              </span>
              <StatusBadge status={service.status} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-fg">{service.name}</h2>
              <p className="mt-1 text-sm text-fg-2">{service.description}</p>
            </div>
            <span className="font-mono text-xs text-fg-3">
              {service.method} {service.path}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
