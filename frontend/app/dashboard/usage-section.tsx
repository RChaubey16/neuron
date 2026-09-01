'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function UsageSection() {
  const usageQuery = useQuery({ queryKey: ['usage'], queryFn: api.getUsage });

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 p-6 dark:border-zinc-800">
      <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
        Usage
      </h2>

      {usageQuery.isLoading && (
        <p className="text-sm text-zinc-500">Loading…</p>
      )}
      {usageQuery.isError && (
        <p className="text-sm text-red-600">Failed to load usage.</p>
      )}
      {usageQuery.data && usageQuery.data.length === 0 && (
        <p className="text-sm text-zinc-500">No usage recorded yet.</p>
      )}

      {usageQuery.data && usageQuery.data.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-800">
              <th className="py-2 font-medium">Date</th>
              <th className="py-2 font-medium">Service</th>
              <th className="py-2 font-medium">Key</th>
              <th className="py-2 font-medium">Calls</th>
            </tr>
          </thead>
          <tbody>
            {usageQuery.data.map((row) => (
              <tr
                key={`${row.date}-${row.service}-${row.apiKeyId}`}
                className="border-b border-zinc-100 dark:border-zinc-900"
              >
                <td className="py-2">{row.date}</td>
                <td className="py-2">{row.service}</td>
                <td className="py-2 font-mono text-zinc-500">
                  {row.apiKeyId.slice(0, 8)}…
                </td>
                <td className="py-2">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
