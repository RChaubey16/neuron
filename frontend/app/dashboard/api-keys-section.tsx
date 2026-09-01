'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CreatedApiKey } from '@/lib/api';
import { CreatedKeyModal } from './created-key-modal';

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

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
      <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
        API Keys
      </h2>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Key name (optional)"
          className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
        >
          {createMutation.isPending ? 'Generating…' : 'Generate key'}
        </button>
      </form>

      {createMutation.isError && (
        <p className="text-sm text-red-600">Failed to generate key.</p>
      )}

      {keysQuery.isLoading && (
        <p className="text-sm text-zinc-500">Loading…</p>
      )}
      {keysQuery.isError && (
        <p className="text-sm text-red-600">Failed to load API keys.</p>
      )}
      {keysQuery.data && keysQuery.data.length === 0 && (
        <p className="text-sm text-zinc-500">No API keys yet.</p>
      )}

      {keysQuery.data && keysQuery.data.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Key</th>
              <th className="py-2 font-medium">Last used</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {keysQuery.data.map((key) => (
              <tr
                key={key.id}
                className="border-b border-zinc-100 dark:border-zinc-900"
              >
                <td className="py-2">{key.name ?? '—'}</td>
                <td className="py-2 font-mono text-zinc-500">
                  {key.keyPrefix}…
                </td>
                <td className="py-2 text-zinc-500">
                  {key.lastUsedAt
                    ? new Date(key.lastUsedAt).toLocaleString()
                    : 'Never'}
                </td>
                <td className="py-2">
                  {key.revokedAt ? (
                    <span className="text-red-600">Revoked</span>
                  ) : (
                    <span className="text-green-600">Active</span>
                  )}
                </td>
                <td className="py-2 text-right">
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
                      className="text-sm text-red-600 hover:underline"
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {createdKey && (
        <CreatedKeyModal
          apiKey={createdKey}
          onClose={() => setCreatedKey(null)}
        />
      )}
    </section>
  );
}
