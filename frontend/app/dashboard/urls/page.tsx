'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { API_URL, api, type ShortUrl } from '@/lib/api';
import { usePaginatedList } from '@/lib/use-paginated-list';
import { Check, Copy, Link2, Plus, TriangleAlert } from 'lucide-react';
import { QueryStateCard } from '../query-state-card';
import { TableSkeleton } from '../table-skeleton';

const PAGE_SIZE = 20;
// Mirrors the backend's MAX_LIST_LIMIT (src/common/dto/pagination-query.dto.ts).
const MAX_LIMIT = 100;

function ShortenUrlForm() {
  const queryClient = useQueryClient();
  const [originalUrl, setOriginalUrl] = useState('');

  const createMutation = useMutation({
    mutationFn: () => api.createShortUrl(originalUrl),
    onSuccess: () => {
      setOriginalUrl('');
      // Prefix match: invalidates every `['short-urls', limit]` query, not
      // just the current page size.
      void queryClient.invalidateQueries({ queryKey: ['short-urls'] });
    },
  });

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-5">
      <label className="text-xs font-medium text-fg-2">Shorten a URL</label>
      <form
        className="flex min-w-0 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
      >
        <input
          value={originalUrl}
          onChange={(e) => setOriginalUrl(e.target.value)}
          placeholder="https://example.com/a/long/path"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-[inset_0_-1px_0_rgba(16,24,40,0.15)] hover:bg-accent-hover disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {createMutation.isPending ? 'Shortening…' : 'Shorten'}
        </button>
      </form>
      {createMutation.isError && (
        <p className="text-sm text-danger">Failed to shorten URL.</p>
      )}
    </div>
  );
}

function CopyLinkButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(`${API_URL}/${code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-fg-2 hover:bg-surface-2"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy link'}
    </button>
  );
}

function UrlsTable({ items }: { items: ShortUrl[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium tracking-wide text-fg-3">
            <th className="px-5 py-3 font-medium">SHORT LINK</th>
            <th className="px-5 py-3 font-medium">ORIGINAL URL</th>
            <th className="px-5 py-3 font-medium">CREATED</th>
            <th className="px-5 py-3 text-right font-medium">CLICKS</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody>
          {items.map((url) => (
            <tr key={url.code} className="border-b border-border last:border-0">
              <td className="px-5 py-4 font-mono text-fg">/{url.code}</td>
              <td className="max-w-xs truncate px-5 py-4 text-fg-2">
                {url.originalUrl}
              </td>
              <td className="px-5 py-4 text-fg-2">
                {new Date(url.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: '2-digit',
                  year: 'numeric',
                })}
              </td>
              <td className="px-5 py-4 text-right text-fg">
                {url.clickCount.toLocaleString()}
              </td>
              <td className="px-5 py-4 text-right">
                <CopyLinkButton code={url.code} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function UrlsPage() {
  const {
    query: urlsQuery,
    items,
    total,
    isLoading,
    isError,
    isEmpty,
    canLoadMore,
    loadMore,
  } = usePaginatedList({
    queryKey: 'short-urls',
    queryFn: api.listShortUrls,
    pageSize: PAGE_SIZE,
    maxLimit: MAX_LIMIT,
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-[22px] font-semibold tracking-tight text-fg">
          URLs
        </h1>
        <p className="mt-1 text-sm text-fg-2">
          Every link shortened by any of your API keys.
        </p>
      </div>

      <ShortenUrlForm />

      {isLoading && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <TableSkeleton
            columns={['SHORT LINK', 'ORIGINAL URL', 'CREATED', 'CLICKS']}
            gridColsClassName="grid-cols-4"
            minWidthClassName="min-w-[640px]"
          />
        </div>
      )}

      {isError && (
        <QueryStateCard
          icon={TriangleAlert}
          iconClassName="bg-danger-soft text-danger"
          title="Couldn't load your URLs"
          description="The URL shortener service didn't respond. Nothing was changed."
          onRetry={() => void urlsQuery.refetch()}
        />
      )}

      {isEmpty && (
        <QueryStateCard
          icon={Link2}
          title="No URLs shortened yet"
          description="Once a key is used to call the URL shortener, links will show up here."
        />
      )}

      {!isLoading && !isError && !isEmpty && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <UrlsTable items={items} />
          <div className="flex items-center justify-between border-t border-border px-5 py-2.5 text-xs text-fg-3">
            <span>
              {items.length} of {total} URLs
            </span>
            {canLoadMore && (
              <button
                onClick={loadMore}
                disabled={urlsQuery.isFetching}
                className="font-medium text-accent hover:text-accent-hover disabled:opacity-50"
              >
                {urlsQuery.isFetching ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
