import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import WebhooksPage from './page';
import {
  api,
  ApiError,
  type WebhookDelivery,
  type WebhookDeliveryList,
  type WebhookEndpoint,
} from '@/lib/api';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      listWebhookEndpoints: vi.fn(),
      createWebhookEndpoint: vi.fn(),
      updateWebhookEndpoint: vi.fn(),
      deleteWebhookEndpoint: vi.fn(),
      rotateWebhookSecret: vi.fn(),
      sendWebhookTest: vi.fn(),
      listWebhookDeliveries: vi.fn(),
      retryWebhookDelivery: vi.fn(),
    },
  };
});

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
      <Toaster />
    </QueryClientProvider>,
  );
}

const listWebhookEndpoints = vi.mocked(api.listWebhookEndpoints);
const createWebhookEndpoint = vi.mocked(api.createWebhookEndpoint);
const updateWebhookEndpoint = vi.mocked(api.updateWebhookEndpoint);
const deleteWebhookEndpoint = vi.mocked(api.deleteWebhookEndpoint);
const rotateWebhookSecret = vi.mocked(api.rotateWebhookSecret);
const sendWebhookTest = vi.mocked(api.sendWebhookTest);
const listWebhookDeliveries = vi.mocked(api.listWebhookDeliveries);
const retryWebhookDelivery = vi.mocked(api.retryWebhookDelivery);

const endpoint: WebhookEndpoint = {
  id: 'endpoint-1',
  url: 'https://example.com/hooks',
  description: 'Production app',
  events: ['email.sent', 'email.failed'],
  enabled: true,
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
};

const failedDelivery: WebhookDelivery = {
  id: 'delivery-1',
  endpointId: 'endpoint-1',
  eventType: 'email.sent',
  payload: {},
  status: 'FAILED',
  attemptsMade: 6,
  responseStatus: 500,
  error: 'Endpoint responded with HTTP 500',
  lastAttemptAt: '2026-09-28T00:10:00.000Z',
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:10:00.000Z',
};

function deliveriesPage(items: WebhookDelivery[]): WebhookDeliveryList {
  return { items, total: items.length, limit: 20, offset: 0 };
}

describe('WebhooksPage', () => {
  it('renders endpoints and deliveries, resolving delivery endpoint URLs', async () => {
    listWebhookEndpoints.mockResolvedValue([endpoint]);
    listWebhookDeliveries.mockResolvedValue(deliveriesPage([failedDelivery]));

    renderWithQueryClient(<WebhooksPage />);

    expect(await screen.findByText('Production app')).toBeInTheDocument();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(
      await screen.findByText('Endpoint responded with HTTP 500'),
    ).toBeInTheDocument();
    // Once in the endpoints table, once in the deliveries table.
    expect(screen.getAllByText('https://example.com/hooks')).toHaveLength(2);
  });

  it('shows empty states when there is nothing yet', async () => {
    listWebhookEndpoints.mockResolvedValue([]);
    listWebhookDeliveries.mockResolvedValue(deliveriesPage([]));

    renderWithQueryClient(<WebhooksPage />);

    expect(await screen.findByText('No endpoints yet')).toBeInTheDocument();
    expect(await screen.findByText('No deliveries yet')).toBeInTheDocument();
  });

  it('labels deliveries whose endpoint was deleted', async () => {
    listWebhookEndpoints.mockResolvedValue([]);
    listWebhookDeliveries.mockResolvedValue(deliveriesPage([failedDelivery]));

    renderWithQueryClient(<WebhooksPage />);

    expect(await screen.findByText('Deleted endpoint')).toBeInTheDocument();
  });

  it('creates an endpoint with the selected events and shows its secret once', async () => {
    listWebhookEndpoints.mockResolvedValue([]);
    listWebhookDeliveries.mockResolvedValue(deliveriesPage([]));
    createWebhookEndpoint.mockResolvedValue({
      ...endpoint,
      events: ['email.sent'],
      secret: 'whsec_abc123',
    });

    const user = userEvent.setup();
    renderWithQueryClient(<WebhooksPage />);

    await user.type(
      screen.getByLabelText('Endpoint URL'),
      'https://example.com/hooks',
    );
    // Both events start checked; subscribe to email.sent only.
    await user.click(screen.getByRole('checkbox', { name: /email\.failed/ }));
    await user.click(screen.getByRole('button', { name: 'Add endpoint' }));

    await waitFor(() =>
      expect(createWebhookEndpoint).toHaveBeenCalledWith({
        url: 'https://example.com/hooks',
        description: undefined,
        events: ['email.sent'],
      }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('whsec_abc123')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeDisabled();
  });

  it('surfaces the backend message when creation is rejected', async () => {
    listWebhookEndpoints.mockResolvedValue([]);
    listWebhookDeliveries.mockResolvedValue(deliveriesPage([]));
    createWebhookEndpoint.mockRejectedValue(
      new ApiError(400, 'URL must use https'),
    );

    const user = userEvent.setup();
    renderWithQueryClient(<WebhooksPage />);

    await user.type(screen.getByLabelText('Endpoint URL'), 'http://example.com');
    await user.click(screen.getByRole('button', { name: 'Add endpoint' }));

    expect(await screen.findByText('Failed to add endpoint')).toBeInTheDocument();
    expect(screen.getByText('URL must use https')).toBeInTheDocument();
  });

  it('sends a test event and disables an endpoint', async () => {
    listWebhookEndpoints.mockResolvedValue([endpoint]);
    listWebhookDeliveries.mockResolvedValue(deliveriesPage([]));
    sendWebhookTest.mockResolvedValue({
      ...failedDelivery,
      eventType: 'webhook.test',
      status: 'PENDING',
    });
    updateWebhookEndpoint.mockResolvedValue({ ...endpoint, enabled: false });

    const user = userEvent.setup();
    renderWithQueryClient(<WebhooksPage />);

    await user.click(await screen.findByRole('button', { name: 'Send test' }));
    expect(await screen.findByText('Test event queued')).toBeInTheDocument();
    expect(sendWebhookTest).toHaveBeenCalledWith('endpoint-1');

    await user.click(screen.getByRole('button', { name: 'Disable' }));
    expect(await screen.findByText('Endpoint disabled')).toBeInTheDocument();
    expect(updateWebhookEndpoint).toHaveBeenCalledWith('endpoint-1', {
      enabled: false,
    });
  });

  it('rotates a secret only after confirming, then reveals the new one', async () => {
    listWebhookEndpoints.mockResolvedValue([endpoint]);
    listWebhookDeliveries.mockResolvedValue(deliveriesPage([]));
    rotateWebhookSecret.mockResolvedValue({ ...endpoint, secret: 'whsec_new' });

    const user = userEvent.setup();
    renderWithQueryClient(<WebhooksPage />);

    await user.click(
      await screen.findByRole('button', { name: 'Rotate secret' }),
    );
    expect(rotateWebhookSecret).not.toHaveBeenCalled();

    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Rotate secret' }));

    expect(await screen.findByText('whsec_new')).toBeInTheDocument();
    expect(
      screen.getByText('Copy your new signing secret'),
    ).toBeInTheDocument();
    expect(rotateWebhookSecret).toHaveBeenCalledWith('endpoint-1');
  });

  it('deletes an endpoint after confirming', async () => {
    listWebhookEndpoints.mockResolvedValue([endpoint]);
    listWebhookDeliveries.mockResolvedValue(deliveriesPage([]));
    deleteWebhookEndpoint.mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderWithQueryClient(<WebhooksPage />);

    await user.click(
      await screen.findByRole('button', {
        name: 'Delete https://example.com/hooks',
      }),
    );
    const confirm = await screen.findByRole('alertdialog');
    await user.click(
      within(confirm).getByRole('button', { name: 'Delete endpoint' }),
    );

    expect(await screen.findByText('Endpoint deleted')).toBeInTheDocument();
    expect(deleteWebhookEndpoint).toHaveBeenCalledWith('endpoint-1');
  });

  it('retries a failed delivery', async () => {
    listWebhookEndpoints.mockResolvedValue([endpoint]);
    listWebhookDeliveries.mockResolvedValue(deliveriesPage([failedDelivery]));
    retryWebhookDelivery.mockResolvedValue({
      ...failedDelivery,
      status: 'PENDING',
    });

    const user = userEvent.setup();
    renderWithQueryClient(<WebhooksPage />);

    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Delivery re-queued')).toBeInTheDocument();
    expect(retryWebhookDelivery).toHaveBeenCalledWith('delivery-1');
  });
});
