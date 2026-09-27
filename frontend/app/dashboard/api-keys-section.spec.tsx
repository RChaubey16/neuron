import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { ApiKeysSection } from './api-keys-section';
import { api, type ApiKey } from '@/lib/api';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      ...actual.api,
      listApiKeys: vi.fn(),
      revokeApiKey: vi.fn(),
      deleteApiKey: vi.fn(),
    },
  };
});

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
      <Toaster />
    </QueryClientProvider>,
  );
}

const listApiKeys = vi.mocked(api.listApiKeys);
const revokeApiKey = vi.mocked(api.revokeApiKey);
const deleteApiKey = vi.mocked(api.deleteApiKey);

function apiKey(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'key-1',
    keyPrefix: 'nrn_abcd1234',
    name: 'production-web',
    createdAt: '2026-09-20T00:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('ApiKeysSection', () => {
  it('shows Revoke and Delete for an active key, but only Delete for a revoked one', async () => {
    listApiKeys.mockResolvedValue([
      apiKey({ id: 'active', name: 'active-key' }),
      apiKey({
        id: 'revoked',
        name: 'revoked-key',
        revokedAt: '2026-09-21T00:00:00.000Z',
      }),
    ]);

    renderWithQueryClient(<ApiKeysSection />);

    expect(await screen.findByText('active-key')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);
  });

  it('deletes a key after confirmation and refetches the list', async () => {
    listApiKeys
      .mockResolvedValueOnce([apiKey()])
      .mockResolvedValueOnce([]);
    deleteApiKey.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const user = userEvent.setup();
    renderWithQueryClient(<ApiKeysSection />);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(deleteApiKey).toHaveBeenCalledWith('key-1');
    expect(await screen.findByText('Key deleted')).toBeInTheDocument();
    expect(
      await screen.findByText('Create your first API key'),
    ).toBeInTheDocument();
  });

  it('does nothing when the delete confirmation is cancelled', async () => {
    listApiKeys.mockResolvedValue([apiKey()]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    const user = userEvent.setup();
    renderWithQueryClient(<ApiKeysSection />);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(deleteApiKey).not.toHaveBeenCalled();
  });

  it('shows an error toast when deleting fails', async () => {
    listApiKeys.mockResolvedValue([apiKey()]);
    deleteApiKey.mockRejectedValue(new Error('network error'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const user = userEvent.setup();
    renderWithQueryClient(<ApiKeysSection />);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText('Failed to delete key'),
    ).toBeInTheDocument();
  });

  it('revokes an active key after confirmation', async () => {
    listApiKeys.mockResolvedValue([apiKey()]);
    revokeApiKey.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const user = userEvent.setup();
    renderWithQueryClient(<ApiKeysSection />);

    await user.click(await screen.findByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(revokeApiKey).toHaveBeenCalledWith('key-1'));
    expect(deleteApiKey).not.toHaveBeenCalled();
  });
});
