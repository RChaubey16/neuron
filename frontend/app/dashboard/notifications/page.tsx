'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type EmailJob, type EmailJobStatus } from '@/lib/api';
import { Ban, Mail, Plus, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react';

const PAGE_SIZE = 20;
// Mirrors the backend's MAX_LIST_LIMIT (src/notifications/dto/list-email-jobs-query.dto.ts).
const MAX_LIMIT = 100;

function SendEmailForm() {
  const queryClient = useQueryClient();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const sendMutation = useMutation({
    mutationFn: () =>
      api.sendEmail({
        to: to
          .split(',')
          .map((address) => address.trim())
          .filter(Boolean),
        subject,
        body,
      }),
    onSuccess: () => {
      setTo('');
      setSubject('');
      setBody('');
      // Prefix match: invalidates every `['email-jobs', limit]` query, not
      // just the current page size.
      void queryClient.invalidateQueries({ queryKey: ['email-jobs'] });
    },
  });

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <label className="text-xs font-medium text-fg-2">Send an email</label>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          sendMutation.mutate();
        }}
      >
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="recipient@example.com, another@example.com"
          className="min-w-0 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none"
        />
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          className="min-w-0 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message body"
          rows={3}
          className="min-w-0 resize-y rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={sendMutation.isPending}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 self-end rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-[inset_0_-1px_0_rgba(16,24,40,0.15)] hover:bg-accent-hover disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {sendMutation.isPending ? 'Sending…' : 'Send'}
        </button>
      </form>
      {sendMutation.isError && (
        <p className="text-sm text-danger">Failed to send email.</p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: EmailJobStatus }) {
  const style: Record<EmailJobStatus, string> = {
    QUEUED: 'bg-surface-2 text-fg-3',
    PROCESSING: 'bg-surface-2 text-fg-3',
    SENT: 'bg-success-soft text-success',
    FAILED: 'bg-danger-soft text-danger',
    CANCELLED: 'bg-surface-2 text-fg-3',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${style[status]}`}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

function JobActions({
  job,
  onRetry,
  onCancel,
  isRetrying,
  isCancelling,
}: {
  job: EmailJob;
  onRetry: (jobId: string) => void;
  onCancel: (jobId: string) => void;
  isRetrying: boolean;
  isCancelling: boolean;
}) {
  if (job.status === 'FAILED') {
    return (
      <button
        onClick={() => onRetry(job.id)}
        disabled={isRetrying}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-50"
      >
        <RotateCcw className="h-3 w-3" />
        {isRetrying ? 'Retrying…' : 'Retry'}
      </button>
    );
  }

  if (job.status === 'QUEUED') {
    return (
      <button
        onClick={() => {
          if (window.confirm('Cancel this email? This cannot be undone.')) {
            onCancel(job.id);
          }
        }}
        disabled={isCancelling}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-fg-2 hover:border-danger/40 hover:bg-danger-soft hover:text-danger disabled:opacity-50"
      >
        <Ban className="h-3 w-3" />
        {isCancelling ? 'Cancelling…' : 'Cancel'}
      </button>
    );
  }

  return null;
}

function JobsTable({
  items,
  onRetry,
  onCancel,
  retryingJobId,
  cancellingJobId,
}: {
  items: EmailJob[];
  onRetry: (jobId: string) => void;
  onCancel: (jobId: string) => void;
  retryingJobId: string | null;
  cancellingJobId: string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium tracking-wide text-fg-3">
            <th className="px-5 py-3 font-medium">TO</th>
            <th className="px-5 py-3 font-medium">SUBJECT</th>
            <th className="px-5 py-3 font-medium">STATUS</th>
            <th className="px-5 py-3 font-medium">CREATED</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody>
          {items.map((job) => (
            <tr key={job.id} className="border-b border-border last:border-0">
              <td className="max-w-xs truncate px-5 py-4 text-fg-2">
                {job.to.join(', ')}
              </td>
              <td className="max-w-xs truncate px-5 py-4 text-fg">
                {job.subject}
              </td>
              <td className="px-5 py-4">
                <StatusBadge status={job.status} />
                {job.status === 'FAILED' && job.error && (
                  <p className="mt-1 max-w-xs truncate text-xs text-danger">
                    {job.error}
                  </p>
                )}
              </td>
              <td className="px-5 py-4 text-fg-2">
                {new Date(job.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: '2-digit',
                  year: 'numeric',
                })}
              </td>
              <td className="px-5 py-4 text-right">
                <JobActions
                  job={job}
                  onRetry={onRetry}
                  onCancel={onCancel}
                  isRetrying={retryingJobId === job.id}
                  isCancelling={cancellingJobId === job.id}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function NotificationsPage() {
  // "Load more" grows `limit` rather than paging via `offset`, so the
  // response's `items` is always the full accumulated list — no client-side
  // merging of separate pages needed. Mirrors /dashboard/urls's pagination.
  const [limit, setLimit] = useState(PAGE_SIZE);
  const queryClient = useQueryClient();

  const jobsQuery = useQuery({
    queryKey: ['email-jobs', limit],
    queryFn: () => api.listEmailJobs({ limit, offset: 0 }),
  });

  const retryMutation = useMutation({
    mutationFn: (jobId: string) => api.retryEmail(jobId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['email-jobs'] }),
  });

  const cancelMutation = useMutation({
    mutationFn: (jobId: string) => api.cancelEmail(jobId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['email-jobs'] }),
  });

  const items = jobsQuery.data?.items ?? [];
  const total = jobsQuery.data?.total ?? 0;
  const isLoading = jobsQuery.status === 'pending';
  const isError = jobsQuery.status === 'error';
  const isEmpty = jobsQuery.status === 'success' && items.length === 0;
  const canLoadMore = items.length < total && limit < MAX_LIMIT;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-[22px] font-semibold tracking-tight text-fg">
          Notifications
        </h1>
        <p className="mt-1 text-sm text-fg-2">
          Every email queued by any of your API keys.
        </p>
      </div>

      <SendEmailForm />

      {isLoading && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="divide-y divide-border overflow-x-auto">
            <div className="grid min-w-[720px] grid-cols-4 gap-4 px-5 py-3 text-xs font-medium tracking-wide text-fg-3">
              {['TO', 'SUBJECT', 'STATUS', 'CREATED'].map((h) => (
                <span key={h}>{h}</span>
              ))}
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="grid min-w-[720px] grid-cols-4 items-center gap-4 px-5 py-4"
              >
                {Array.from({ length: 4 }).map((__, j) => (
                  <span
                    key={j}
                    className="h-3.5 w-3/4 animate-pulse rounded bg-surface-2"
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-danger-soft text-danger">
            <TriangleAlert className="h-5 w-5" />
          </span>
          <h2 className="text-base font-semibold text-fg">
            Couldn&apos;t load your notifications
          </h2>
          <p className="max-w-sm text-sm text-fg-2">
            The notifications service didn&apos;t respond. Nothing was
            changed.
          </p>
          <button
            onClick={() => void jobsQuery.refetch()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-2"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Mail className="h-5 w-5" />
          </span>
          <h2 className="text-base font-semibold text-fg">
            No emails sent yet
          </h2>
          <p className="max-w-sm text-sm text-fg-2">
            Once a key is used to call the notifications service, emails will
            show up here.
          </p>
        </div>
      )}

      {(retryMutation.isError || cancelMutation.isError) && (
        <p className="text-sm text-danger">
          {retryMutation.isError
            ? 'Failed to retry email.'
            : 'Failed to cancel email.'}
        </p>
      )}

      {!isLoading && !isError && !isEmpty && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <JobsTable
            items={items}
            onRetry={(jobId) => retryMutation.mutate(jobId)}
            onCancel={(jobId) => cancelMutation.mutate(jobId)}
            retryingJobId={
              retryMutation.isPending ? (retryMutation.variables ?? null) : null
            }
            cancellingJobId={
              cancelMutation.isPending ? (cancelMutation.variables ?? null) : null
            }
          />
          <div className="flex items-center justify-between border-t border-border px-5 py-2.5 text-xs text-fg-3">
            <span>
              {items.length} of {total} emails
            </span>
            {canLoadMore && (
              <button
                onClick={() => setLimit((l) => Math.min(l + PAGE_SIZE, MAX_LIMIT))}
                disabled={jobsQuery.isFetching}
                className="font-medium text-accent hover:text-accent-hover disabled:opacity-50"
              >
                {jobsQuery.isFetching ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
