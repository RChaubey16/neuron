import { Bell, Link2, type LucideIcon } from 'lucide-react';
import { API_URL } from '@/lib/api';
import { CodeBlock } from './curl-example';

interface Endpoint {
  method: string;
  path: string;
  description: string;
}

interface ServiceInfo {
  name: string;
  description: string;
  status: 'Generally available' | 'Planned';
  icon: LucideIcon;
  /** Every route this service exposes. The first entry is the primary one shown with a full example below. */
  endpoints: [Endpoint, ...Endpoint[]];
  /** curl command and example response for the primary endpoint, shown once GA. Omitted for planned services. */
  example?: { curl: string; response: string };
}

// Mirrors the actual state of src/ — only list a service once its module exists,
// and keep its endpoint list in sync with docs/API.md when routes are added.
const SERVICES: ServiceInfo[] = [
  {
    name: 'URL shortener',
    description: 'Create, resolve and expire short links. Click counts included.',
    status: 'Generally available',
    icon: Link2,
    endpoints: [
      {
        method: 'POST',
        path: '/api/v1/short-url/shorten',
        description: 'Create a short link',
      },
    ],
    example: {
      curl: `curl -X POST ${API_URL}/api/v1/short-url/shorten \\
  -H "x-api-key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"originalUrl": "https://example.com/very/long/path"}'`,
      response: `{
  "code": "aZ3xQ2p",
  "originalUrl": "https://example.com/very/long/path",
  "createdAt": "2026-09-02T10:15:00.000Z",
  "clickCount": 0
}`,
    },
  },
  {
    name: 'Notifications',
    description:
      'Durable, queued email delivery via Resend — jobs can be tracked, retried, or cancelled after they’re created.',
    status: 'Generally available',
    icon: Bell,
    endpoints: [
      {
        method: 'POST',
        path: '/api/v1/notifications/email',
        description: 'Queue a one-off email',
      },
      {
        method: 'GET',
        path: '/api/v1/notifications/email/templates',
        description: 'List predefined templates',
      },
      {
        method: 'POST',
        path: '/api/v1/notifications/email/templates/:templateKey/send',
        description: 'Render and queue a templated email',
      },
      {
        method: 'GET',
        path: '/api/v1/notifications/email/:jobId',
        description: "Check a job's status",
      },
      {
        method: 'POST',
        path: '/api/v1/notifications/email/:jobId/retry',
        description: 'Retry a failed job',
      },
      {
        method: 'DELETE',
        path: '/api/v1/notifications/email/:jobId',
        description: "Cancel a job that hasn't started processing",
      },
    ],
    example: {
      curl: `curl -X POST ${API_URL}/api/v1/notifications/email \\
  -H "x-api-key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"to": ["user@example.com"], "subject": "Hello", "body": "Message body"}'`,
      response: `{
  "id": "9c1e...-uuid",
  "status": "QUEUED",
  "to": ["user@example.com"],
  "subject": "Hello",
  "error": null,
  "attemptsMade": 0,
  "resendId": null,
  "createdAt": "2026-09-15T12:00:00.000Z",
  "updatedAt": "2026-09-15T12:00:00.000Z"
}`,
    },
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
              {service.endpoints[0].method} {service.endpoints[0].path}
            </span>
            {service.endpoints.length > 1 && (
              <ul className="flex flex-col gap-1 border-t border-border pt-3">
                {service.endpoints.slice(1).map((endpoint) => (
                  <li
                    key={`${endpoint.method} ${endpoint.path}`}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
                  >
                    <span className="font-mono text-fg-3">
                      {endpoint.method} {endpoint.path}
                    </span>
                    <span className="text-fg-2">— {endpoint.description}</span>
                  </li>
                ))}
              </ul>
            )}
            {service.example && (
              <div className="flex flex-col gap-3 border-t border-border pt-3">
                <CodeBlock
                  label="Example request"
                  code={service.example.curl}
                  copyable
                />
                <CodeBlock
                  label="Example response"
                  code={service.example.response}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
