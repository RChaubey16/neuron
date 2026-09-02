'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ApiKey, type CreatedApiKey } from '@/lib/api';
import { CreatedKeyModal } from './created-key-modal';
import { Ban, KeyRound, Plus, RefreshCw, TriangleAlert } from 'lucide-react';

const SKELETON_ROWS = 4;

function StatusBadge({ revoked }: { revoked: boolean }) {
  if (revoked) {
    return (
      <span className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-fg-3">
        Revoked
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success">
      Active
    </span>
  );
}

function KeyNameInput({
  name,
  onChange,
  onSubmit,
  pending,
  className = '',
}: {
  name: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  className?: string;
}) {
  return (
    <form
      className={`flex gap-2 ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <input
        value={name}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. production-web"
        className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none"
      />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-[inset_0_-1px_0_rgba(16,24,40,0.15)] hover:bg-accent-hover disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        {pending ? 'Generating…' : 'Generate key'}
      </button>
    </form>
  );
}

export function ApiKeysSection() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);

  const keysQuery = useQuery({ queryKey: ['api-keys'], queryFn: api.listApiKeys });

  const createMutation = useMutation({
    mutationFn: () => api.createApiKey(name || undefined),
    onSuccess: (key) => {
      setCreatedKey(key);
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  const keys: ApiKey[] | undefined = keysQuery.data;
  const isEmpty = keysQuery.status === 'success' && keys?.length === 0;
  const activeCount = keys?.filter((k) => !k.revokedAt).length ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-[22px] font-semibold tracking-tight text-fg">
          API keys
        </h1>
        <p className="mt-1 text-sm text-fg-2">
          Keys authenticate every request to{' '}
          <code className="font-mono text-fg-3">api.neuron.dev</code>. Treat
          them like passwords.
        </p>
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <KeyRound className="h-5 w-5" />
          </span>
          <h2 className="text-base font-semibold text-fg">
            Create your first API key
          </h2>
          <p className="max-w-sm text-sm text-fg-2">
            You need a key to call the URL shortener or send a notification.
            Name it after where it will live, so you know what to revoke
            later.
          </p>
          {createMutation.isError && (
            <p className="text-sm text-danger">Failed to generate key.</p>
          )}
          <KeyNameInput
            name={name}
            onChange={setName}
            onSubmit={() => createMutation.mutate()}
            pending={createMutation.isPending}
            className="mt-2 w-full max-w-sm"
          />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
            <label className="text-xs font-medium text-fg-2">
              Key name — optional
            </label>
            <div className="flex items-center gap-3">
              <KeyNameInput
                name={name}
                onChange={setName}
                onSubmit={() => createMutation.mutate()}
                pending={createMutation.isPending}
                className="flex-1"
              />
              <span className="hidden shrink-0 text-xs text-fg-3 sm:inline">
                The full key is shown once, at creation.
              </span>
            </div>
            {createMutation.isError && (
              <p className="text-sm text-danger">Failed to generate key.</p>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            {keysQuery.status === 'pending' && (
              <div className="divide-y divide-border">
                <div className="grid grid-cols-5 gap-4 px-5 py-3 text-xs font-medium tracking-wide text-fg-3">
                  {['NAME', 'KEY', 'CREATED', 'LAST USED', 'STATUS'].map(
                    (h) => (
                      <span key={h}>{h}</span>
                    ),
                  )}
                </div>
                {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                  <div
                    key={i}
                    className="grid grid-cols-5 items-center gap-4 px-5 py-4"
                  >
                    {Array.from({ length: 5 }).map((__, j) => (
                      <span
                        key={j}
                        className="h-3.5 w-3/4 animate-pulse rounded bg-surface-2"
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}

            {keysQuery.status === 'error' && (
              <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-danger-soft text-danger">
                  <TriangleAlert className="h-5 w-5" />
                </span>
                <h2 className="text-base font-semibold text-fg">
                  Couldn&apos;t load your keys
                </h2>
                <p className="max-w-sm text-sm text-fg-2">
                  The keys service didn&apos;t respond. Your keys are
                  unaffected — nothing was changed.
                </p>
                <button
                  onClick={() => void keysQuery.refetch()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </button>
              </div>
            )}

            {keysQuery.status === 'success' && keys && keys.length > 0 && (
              <>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs font-medium tracking-wide text-fg-3">
                      <th className="px-5 py-3 font-medium">NAME</th>
                      <th className="px-5 py-3 font-medium">KEY</th>
                      <th className="px-5 py-3 font-medium">CREATED</th>
                      <th className="px-5 py-3 font-medium">LAST USED</th>
                      <th className="px-5 py-3 font-medium">STATUS</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((key) => (
                      <tr key={key.id} className="border-b border-border last:border-0">
                        <td className="px-5 py-4 font-medium text-fg">
                          {key.name ?? '—'}
                        </td>
                        <td className="px-5 py-4 font-mono text-fg-3">
                          {key.keyPrefix}…
                        </td>
                        <td className="px-5 py-4 text-fg-2">
                          {new Date(key.createdAt).toLocaleDateString(
                            'en-US',
                            { month: 'short', day: '2-digit', year: 'numeric' },
                          )}
                        </td>
                        <td className="px-5 py-4 text-fg-2">
                          {key.lastUsedAt
                            ? new Date(key.lastUsedAt).toLocaleString()
                            : 'Never'}
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge revoked={Boolean(key.revokedAt)} />
                        </td>
                        <td className="px-5 py-4 text-right">
                          {!key.revokedAt && (
                            <button
                              onClick={() => {
                                if (
                                  window.confirm(
                                    'Revoke this key? This cannot be undone.',
                                  )
                                ) {
                                  revokeMutation.mutate(key.id);
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-fg-2 hover:border-danger/40 hover:bg-danger-soft hover:text-danger"
                            >
                              <Ban className="h-3 w-3" />
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex items-center justify-between border-t border-border px-5 py-2.5 text-xs text-fg-3">
                  <span>
                    {keys.length} keys · {activeCount} active
                  </span>
                  <span className="font-mono">GET /v1/keys</span>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {createdKey && (
        <CreatedKeyModal
          apiKey={createdKey}
          onClose={() => setCreatedKey(null)}
        />
      )}
    </div>
  );
}
