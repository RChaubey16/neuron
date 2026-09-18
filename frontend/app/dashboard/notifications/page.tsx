'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type EmailJob, type EmailJobStatus } from '@/lib/api';
import { usePaginatedList } from '@/lib/use-paginated-list';
import {
  Ban,
  FileText,
  Mail,
  Plus,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react';
import { QueryStateCard } from '../query-state-card';
import { TableSkeleton } from '../table-skeleton';

const PAGE_SIZE = 20;
// Mirrors the backend's MAX_LIST_LIMIT (src/common/dto/pagination-query.dto.ts).
const MAX_LIMIT = 100;

// Sentinel template-select value for writing a one-off subject/body by hand,
// distinct from every real template key (which comes from the API).
const CUSTOM_TEMPLATE = '__custom__';
const DEFAULT_TEMPLATE_KEY = 'welcome';

const inputClassName =
  'min-w-0 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none';

function TemplateVariableFields({
  variables,
  values,
  onChange,
}: {
  variables: string[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {variables.map((name) => (
        <div key={name} className="flex flex-col gap-1">
          <label
            htmlFor={`template-var-${name}`}
            className="text-xs font-medium text-fg-3"
          >
            {name}
          </label>
          <input
            id={`template-var-${name}`}
            value={values[name] ?? ''}
            onChange={(e) => onChange(name, e.target.value)}
            className={inputClassName}
          />
        </div>
      ))}
    </div>
  );
}

function SendEmailForm() {
  const queryClient = useQueryClient();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [templateKey, setTemplateKey] = useState(DEFAULT_TEMPLATE_KEY);
  const [variables, setVariables] = useState<Record<string, string>>({});

  const templatesQuery = useQuery({
    queryKey: ['email-templates'],
    queryFn: api.listEmailTemplates,
  });

  const isCustom = templateKey === CUSTOM_TEMPLATE;
  const selectedTemplate = templatesQuery.data?.find(
    (template) => template.key === templateKey,
  );

  const sendMutation = useMutation({
    mutationFn: () => {
      const recipients = to
        .split(',')
        .map((address) => address.trim())
        .filter(Boolean);

      return isCustom
        ? api.sendEmail({ to: recipients, subject, body })
        : api.sendTemplatedEmail(templateKey, { to: recipients, variables });
    },
    onSuccess: () => {
      setTo('');
      setSubject('');
      setBody('');
      setVariables({});
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
          className={inputClassName}
        />

        <div className="flex flex-col gap-1">
          <label htmlFor="template-select" className="text-xs font-medium text-fg-3">
            Template
          </label>
          <select
            id="template-select"
            value={templateKey}
            onChange={(e) => {
              setTemplateKey(e.target.value);
              setVariables({});
            }}
            className={inputClassName}
          >
            {/* DEFAULT_TEMPLATE_KEY is always included, even before the
                template list has loaded, so this controlled <select> can
                actually display it as selected from the very first render —
                otherwise, with no matching <option> yet, the browser falls
                back to displaying the first available option (Custom)
                despite templateKey's state already being 'welcome'. */}
            {Array.from(
              new Set([
                DEFAULT_TEMPLATE_KEY,
                ...(templatesQuery.data ?? []).map((template) => template.key),
              ]),
            ).map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
            <option value={CUSTOM_TEMPLATE}>Custom</option>
          </select>
        </div>

        {isCustom ? (
          <>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className={inputClassName}
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Message body"
              rows={3}
              className={`resize-y ${inputClassName}`}
            />
          </>
        ) : templatesQuery.isLoading ? (
          <p className="text-sm text-fg-3">Loading template…</p>
        ) : (
          selectedTemplate && (
            <TemplateVariableFields
              variables={selectedTemplate.requiredVariables}
              values={variables}
              onChange={(name, value) =>
                setVariables((current) => ({ ...current, [name]: value }))
              }
            />
          )
        )}

        <button
          type="submit"
          disabled={
            sendMutation.isPending || (!isCustom && templatesQuery.isLoading)
          }
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
  const queryClient = useQueryClient();

  const {
    query: jobsQuery,
    items,
    total,
    isLoading,
    isError,
    isEmpty,
    canLoadMore,
    loadMore,
  } = usePaginatedList({
    queryKey: 'email-jobs',
    queryFn: api.listEmailJobs,
    pageSize: PAGE_SIZE,
    maxLimit: MAX_LIMIT,
  });

  const retryMutation = useMutation({
    mutationFn: (jobId: string) => api.retryEmail(jobId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['email-jobs'] }),
  });

  const cancelMutation = useMutation({
    mutationFn: (jobId: string) => api.cancelEmail(jobId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['email-jobs'] }),
  });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[22px] font-semibold tracking-tight text-fg">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-fg-2">
            Every email queued by any of your API keys.
          </p>
        </div>
        <Link
          href="/dashboard/notifications/templates"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-fg-2 hover:bg-surface-2"
        >
          <FileText className="h-3.5 w-3.5" />
          View templates
        </Link>
      </div>

      <SendEmailForm />

      {isLoading && (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <TableSkeleton
            columns={['TO', 'SUBJECT', 'STATUS', 'CREATED']}
            gridColsClassName="grid-cols-4"
            minWidthClassName="min-w-[720px]"
          />
        </div>
      )}

      {isError && (
        <QueryStateCard
          icon={TriangleAlert}
          iconClassName="bg-danger-soft text-danger"
          title="Couldn't load your notifications"
          description="The notifications service didn't respond. Nothing was changed."
          onRetry={() => void jobsQuery.refetch()}
        />
      )}

      {isEmpty && (
        <QueryStateCard
          icon={Mail}
          title="No emails sent yet"
          description="Once a key is used to call the notifications service, emails will show up here."
        />
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
                onClick={loadMore}
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
