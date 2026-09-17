import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UsagePage from './page';
import { api, type UsageSummary } from '@/lib/api';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: { ...actual.api, getUsage: vi.fn(), listApiKeys: vi.fn() },
  };
});

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

const getUsage = vi.mocked(api.getUsage);
const listApiKeys = vi.mocked(api.listApiKeys);

const today = new Date().toISOString().slice(0, 10);

describe('UsagePage', () => {
  it('renders a fallback label for a row with a null apiKeyId instead of throwing', async () => {
    listApiKeys.mockResolvedValue([]);
    const rows: UsageSummary[] = [
      { service: 'url-shortener', date: today, apiKeyId: null, count: 4 },
    ];
    getUsage.mockResolvedValue(rows);

    renderWithQueryClient(<UsagePage />);

    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
  });
});
