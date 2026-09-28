'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  KeyRound,
  Plus,
  Power,
  RotateCcw,
  Send,
  Trash2,
  TriangleAlert,
  Webhook,
} from 'lucide-react';
import {
  api,
  describeError,
  WEBHOOK_EVENTS,
  type WebhookDelivery,
  type WebhookDeliveryStatus,
  type WebhookEndpoint,
  type WebhookEndpointWithSecret,
  type WebhookEvent,
} from '@/lib/api';
import { usePaginatedList } from '@/lib/use-paginated-list';
import { QueryStateCard } from '../query-state-card';
import { TableSkeleton } from '../table-skeleton';
import { SecretModal } from './secret-modal';
import {
  EndpointActionDialog,
  type EndpointAction,
} from './endpoint-action-dialog';

const PAGE_SIZE = 20;
// Mirrors the backend's MAX_LIST_LIMIT (src/common/dto/pagination-query.dto.ts).
const MAX_LIMIT = 100;

const EVENT_DESCRIPTIONS: Record<WebhookEvent, string> = {
  'email.sent': 'An email was delivered to Resend',
  'email.failed': 'An email failed after its last retry',
};

const inputClassName =
  'min-w-0 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-fg-3 focus:border-accent focus:outline-none';

const smallButtonClassName =
  'inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-fg-2 hover:bg-surface-2 disabled:opacity-50';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function CreateEndpointForm({
  onCreated,
}: {
  onCreated: (endpoint: WebhookEndpointWithSecret) => void;
}) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>([...WEBHOOK_EVENTS]);

  const createMutation = useMutation({
    mutationFn: () =>
      api.createWebhookEndpoint({
        url: url.trim(),
        description: description.trim() || undefined,
        events,
      }),
    onSuccess: (endpoint) => {
      setUrl('');
      setDescription('');
      setEvents([...WEBHOOK_EVENTS]);
      void queryClient.invalidateQueries({ queryKey: ['webhook-endpoints'] });
      onCreated(endpoint);
    },
    onError: (error) =>
      toast.error('Failed to add endpoint', {
        description: describeError(error),
      }),
  });

  function toggleEvent(event: WebhookEvent) {
    setEvents((current) =>
      current.includes(event)
        ? current.filter((e) => e !== event)
        : [...current, event],
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <label className="text-xs font-medium text-fg-2">Add an endpoint</label>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-app.com/webhooks/neuron"
            aria-label="Endpoint URL"
            className={`flex-1 ${inputClassName}`}
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            aria-label="Description"
            className={`sm:w-56 ${inputClassName}`}
          />
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs font-medium text-fg-3">Events</legend>
          {WEBHOOK_EVENTS.map((event) => (
            <label
              key={event}
              className="flex items-center gap-2 text-sm text-fg-2"
            >
              <input
                type="checkbox"
                checked={events.includes(event)}
                onChange={() => toggleEvent(event)}
                className="h-4 w-4 rounded border-border-strong accent-accent"
              />
              <code className="font-mono text-xs text-fg">{event}</code>
              <span className="text-xs text-fg-3">
                {EVENT_DESCRIPTIONS[event]}
              </span>
            </label>
          ))}
        </fieldset>

        <button
          type="submit"
          disabled={createMutation.isPending || !url.trim() || events.length === 0}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 self-end rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-[inset_0_-1px_0_rgba(16,24,40,0.15)] hover:bg-accent-hover disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {createMutation.isPending ? 'Adding…' : 'Add endpoint'}
        </button>
      </form>
    </div>
  );
}

function EndpointsTable({
  endpoints,
  onTest,
  onToggle,
  onRequestAction,
  testingId,
  togglingId,
}: {
  endpoints: WebhookEndpoint[];
  onTest: (endpointId: string) => void;
  onToggle: (endpoint: WebhookEndpoint) => void;
  onRequestAction: (endpoint: WebhookEndpoint, action: EndpointAction) => void;
  testingId: string | null;
  togglingId: string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium tracking-wide text-fg-3">
            <th className="px-5 py-3 font-medium">URL</th>
            <th className="px-5 py-3 font-medium">EVENTS</th>
            <th className="px-5 py-3 font-medium">STATUS</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody>
          {endpoints.map((endpoint) => (
            <tr key={endpoint.id} className="border-b border-border last:border-0">
              <td className="max-w-xs px-5 py-4">
                <p className="truncate font-mono text-xs text-fg">{endpoint.url}</p>
                {endpoint.description && (
                  <p className="mt-0.5 truncate text-xs text-fg-3">
                    {endpoint.description}
                  </p>
                )}
              </td>
              <td className="px-5 py-4">
                <div className="flex flex-wrap gap-1">
                  {endpoint.events.map((event) => (
                    <span
                      key={event}
                      className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-2"
                    >
                      {event}
                    </span>
                  ))}
                </div>
              </td>
              <td className="px-5 py-4">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    endpoint.enabled
                      ? 'bg-success-soft text-success'
                      : 'bg-surface-2 text-fg-3'
                  }`}
                >
                  {endpoint.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </td>
              <td className="px-5 py-4">
                <div className="flex justify-end gap-1.5">
                  <button
                    onClick={() => onTest(endpoint.id)}
                    disabled={!endpoint.enabled || testingId === endpoint.id}
                    className={smallButtonClassName}
                  >
                    <Send className="h-3 w-3" />
                    {testingId === endpoint.id ? 'Sending…' : 'Send test'}
                  </button>
                  <button
                    onClick={() => onToggle(endpoint)}
                    disabled={togglingId === endpoint.id}
                    className={smallButtonClassName}
                  >
                    <Power className="h-3 w-3" />
                    {endpoint.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    onClick={() => onRequestAction(endpoint, 'rotate')}
                    className={smallButtonClassName}
                  >
                    <KeyRound className="h-3 w-3" />
                    Rotate secret
                  </button>
                  <button
                    onClick={() => onRequestAction(endpoint, 'delete')}
                    aria-label={`Delete ${endpoint.url}`}
                    className={`${smallButtonClassName} hover:border-danger/40 hover:bg-danger-soft hover:text-danger`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DELIVERY_STATUS_STYLES: Record<WebhookDeliveryStatus, string> = {
  PENDING: 'bg-surface-2 text-fg-3',
  SUCCEEDED: 'bg-success-soft text-success',
  FAILED: 'bg-danger-soft text-danger',
};

function DeliveriesTable({
  items,
  endpointUrls,
  onRetry,
  retryingId,
}: {
  items: WebhookDelivery[];
  endpointUrls: Map<string, string>;
  onRetry: (deliveryId: string) => void;
  retryingId: string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs font-medium tracking-wide text-fg-3">
            <th className="px-5 py-3 font-medium">EVENT</th>
            <th className="px-5 py-3 font-medium">ENDPOINT</th>
            <th className="px-5 py-3 font-medium">STATUS</th>
            <th className="px-5 py-3 font-medium">ATTEMPTS</th>
            <th className="px-5 py-3 font-medium">CREATED</th>
            <th className="px-5 py-3" />
          </tr>
        </thead>
        <tbody>
          {items.map((delivery) => (
            <tr key={delivery.id} className="border-b border-border last:border-0">
              <td className="px-5 py-4 font-mono text-xs text-fg">
                {delivery.eventType}
              </td>
              <td className="max-w-[14rem] truncate px-5 py-4 font-mono text-xs text-fg-2">
                {endpointUrls.get(delivery.endpointId) ?? (
                  <span className="font-sans text-fg-3">Deleted endpoint</span>
                )}
              </td>
              <td className="px-5 py-4">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${DELIVERY_STATUS_STYLES[delivery.status]}`}
                >
                  {delivery.status.charAt(0) + delivery.status.slice(1).toLowerCase()}
                </span>
                {delivery.status !== 'SUCCEEDED' && delivery.error && (
                  <p
                    className={`mt-1 max-w-xs truncate text-xs ${
                      delivery.status === 'FAILED' ? 'text-danger' : 'text-fg-3'
                    }`}
                  >
                    {delivery.error}
                  </p>
                )}
              </td>
              <td className="px-5 py-4 text-fg-2">{delivery.attemptsMade}</td>
              <td className="px-5 py-4 whitespace-nowrap text-fg-2">
                {formatDateTime(delivery.createdAt)}
              </td>
              <td className="px-5 py-4 text-right">
                {delivery.status === 'FAILED' && (
                  <button
                    onClick={() => onRetry(delivery.id)}
                    disabled={retryingId === delivery.id}
                    className={smallButtonClassName}
                  >
                    <RotateCcw className="h-3 w-3" />
                    {retryingId === delivery.id ? 'Retrying…' : 'Retry'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function WebhooksPage() {
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState<{
    endpoint: WebhookEndpointWithSecret;
    rotated: boolean;
  } | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    endpoint: WebhookEndpoint;
    action: EndpointAction;
  } | null>(null);

  const endpointsQuery = useQuery({
    queryKey: ['webhook-endpoints'],
    queryFn: api.listWebhookEndpoints,
  });
  const endpoints = endpointsQuery.data ?? [];
  const endpointUrls = new Map(endpoints.map((e) => [e.id, e.url]));

  const deliveries = usePaginatedList({
    queryKey: 'webhook-deliveries',
    queryFn: api.listWebhookDeliveries,
    pageSize: PAGE_SIZE,
    maxLimit: MAX_LIMIT,
  });

  const invalidateEndpoints = () =>
    queryClient.invalidateQueries({ queryKey: ['webhook-endpoints'] });
  // Prefix match: every `['webhook-deliveries', limit]` query.
  const invalidateDeliveries = () =>
    queryClient.invalidateQueries({ queryKey: ['webhook-deliveries'] });

  const testMutation = useMutation({
    mutationFn: (endpointId: string) => api.sendWebhookTest(endpointId),
    onSuccess: () => {
      toast.success('Test event queued');
      void invalidateDeliveries();
    },
    onError: (error) =>
      toast.error('Failed to send test event', {
        description: describeError(error),
      }),
  });

  const toggleMutation = useMutation({
    mutationFn: (endpoint: WebhookEndpoint) =>
      api.updateWebhookEndpoint(endpoint.id, { enabled: !endpoint.enabled }),
    onSuccess: (endpoint) => {
      toast.success(endpoint.enabled ? 'Endpoint enabled' : 'Endpoint disabled');
      void invalidateEndpoints();
    },
    onError: (error) =>
      toast.error('Failed to update endpoint', {
        description: describeError(error),
      }),
  });

  const actionMutation = useMutation({
    mutationFn: async ({
      endpointId,
      action,
    }: {
      endpointId: string;
      action: EndpointAction;
    }) =>
      action === 'rotate'
        ? api.rotateWebhookSecret(endpointId)
        : api.deleteWebhookEndpoint(endpointId),
    onSuccess: (result, { action }) => {
      setPendingAction(null);
      void invalidateEndpoints();
      if (action === 'rotate' && result) {
        setRevealed({ endpoint: result, rotated: true });
      } else {
        toast.success('Endpoint deleted');
      }
    },
    onError: (error, { action }) =>
      toast.error(
        action === 'rotate' ? 'Failed to rotate secret' : 'Failed to delete endpoint',
        { description: describeError(error) },
      ),
  });

  const retryMutation = useMutation({
    mutationFn: (deliveryId: string) => api.retryWebhookDelivery(deliveryId),
    onSuccess: () => {
      toast.success('Delivery re-queued');
      void invalidateDeliveries();
    },
    onError: (error) =>
      toast.error('Failed to retry delivery', {
        description: describeError(error),
      }),
  });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-[22px] font-semibold tracking-tight text-fg">
          Webhooks
        </h1>
        <p className="mt-1 text-sm text-fg-2">
          Get a signed POST when something happens in Neuron, for jobs created
          by any of your API keys or from this dashboard.
        </p>
      </div>

      <CreateEndpointForm
        onCreated={(endpoint) => setRevealed({ endpoint, rotated: false })}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-fg">Endpoints</h2>
        {endpointsQuery.status === 'pending' && (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <TableSkeleton
              columns={['URL', 'EVENTS', 'STATUS']}
              gridColsClassName="grid-cols-3"
              minWidthClassName="min-w-[760px]"
            />
          </div>
        )}
        {endpointsQuery.status === 'error' && (
          <QueryStateCard
            icon={TriangleAlert}
            iconClassName="bg-danger-soft text-danger"
            title="Couldn't load your endpoints"
            description="The webhooks service didn't respond. Nothing was changed."
            onRetry={() => void endpointsQuery.refetch()}
          />
        )}
        {endpointsQuery.status === 'success' && endpoints.length === 0 && (
          <QueryStateCard
            icon={Webhook}
            title="No endpoints yet"
            description="Add an endpoint above to start receiving events."
          />
        )}
        {endpoints.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <EndpointsTable
              endpoints={endpoints}
              onTest={(endpointId) => testMutation.mutate(endpointId)}
              onToggle={(endpoint) => toggleMutation.mutate(endpoint)}
              onRequestAction={(endpoint, action) =>
                setPendingAction({ endpoint, action })
              }
              testingId={
                testMutation.isPending ? (testMutation.variables ?? null) : null
              }
              togglingId={
                toggleMutation.isPending
                  ? (toggleMutation.variables?.id ?? null)
                  : null
              }
            />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-fg">Recent deliveries</h2>
        {deliveries.isLoading && (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <TableSkeleton
              columns={['EVENT', 'ENDPOINT', 'STATUS', 'ATTEMPTS', 'CREATED']}
              gridColsClassName="grid-cols-5"
              minWidthClassName="min-w-[760px]"
            />
          </div>
        )}
        {deliveries.isError && (
          <QueryStateCard
            icon={TriangleAlert}
            iconClassName="bg-danger-soft text-danger"
            title="Couldn't load deliveries"
            description="The webhooks service didn't respond. Nothing was changed."
            onRetry={() => void deliveries.query.refetch()}
          />
        )}
        {deliveries.isEmpty && (
          <QueryStateCard
            icon={Send}
            title="No deliveries yet"
            description="Send a test event, or queue an email, to see deliveries here."
          />
        )}
        {!deliveries.isLoading && !deliveries.isError && !deliveries.isEmpty && (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <DeliveriesTable
              items={deliveries.items}
              endpointUrls={endpointUrls}
              onRetry={(deliveryId) => retryMutation.mutate(deliveryId)}
              retryingId={
                retryMutation.isPending ? (retryMutation.variables ?? null) : null
              }
            />
            <div className="flex items-center justify-between border-t border-border px-5 py-2.5 text-xs text-fg-3">
              <span>
                {deliveries.items.length} of {deliveries.total} deliveries
              </span>
              {deliveries.canLoadMore && (
                <button
                  onClick={deliveries.loadMore}
                  disabled={deliveries.query.isFetching}
                  className="font-medium text-accent hover:text-accent-hover disabled:opacity-50"
                >
                  {deliveries.query.isFetching ? 'Loading…' : 'Load more'}
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      <EndpointActionDialog
        target={pendingAction}
        pending={actionMutation.isPending}
        onConfirm={(endpointId, action) =>
          actionMutation.mutate({ endpointId, action })
        }
        onOpenChange={(open) => {
          if (!open) setPendingAction(null);
        }}
      />

      {revealed && (
        <SecretModal
          endpoint={revealed.endpoint}
          rotated={revealed.rotated}
          onClose={() => setRevealed(null)}
        />
      )}
    </div>
  );
}
