import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UrlsPage from './page';
import { api, type ShortUrlList } from '@/lib/api';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: { ...actual.api, listShortUrls: vi.fn() } };
});

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

const listShortUrls = vi.mocked(api.listShortUrls);

function page(items: ShortUrlList['items'], total: number, limit: number): ShortUrlList {
  return { items, total, limit, offset: 0 };
}

describe('UrlsPage', () => {
  it('renders each URL row once data loads', async () => {
    listShortUrls.mockResolvedValue(
      page(
        [
          {
            code: 'aaa1111',
            originalUrl: 'https://example.com/a',
            createdAt: '2026-09-16T00:00:00.000Z',
            clickCount: 3,
          },
        ],
        1,
        20,
      ),
    );

    renderWithQueryClient(<UrlsPage />);

    expect(await screen.findByText('/aaa1111')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/a')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows an empty state when no URLs exist yet', async () => {
    listShortUrls.mockResolvedValue(page([], 0, 20));

    renderWithQueryClient(<UrlsPage />);

    expect(
      await screen.findByText('No URLs shortened yet'),
    ).toBeInTheDocument();
  });

  it('shows an error state and retries on demand', async () => {
    listShortUrls.mockRejectedValueOnce(new Error('network error'));
    listShortUrls.mockResolvedValueOnce(page([], 0, 20));

    const user = userEvent.setup();
    renderWithQueryClient(<UrlsPage />);

    expect(
      await screen.findByText("Couldn't load your URLs"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(
      await screen.findByText('No URLs shortened yet'),
    ).toBeInTheDocument();
  });

  it('grows the limit instead of the offset when loading more', async () => {
    listShortUrls.mockResolvedValueOnce(
      page(
        Array.from({ length: 20 }, (_, i) => ({
          code: `code${i}`,
          originalUrl: `https://example.com/${i}`,
          createdAt: '2026-09-16T00:00:00.000Z',
          clickCount: 0,
        })),
        45,
        20,
      ),
    );

    const user = userEvent.setup();
    renderWithQueryClient(<UrlsPage />);

    const loadMore = await screen.findByRole('button', { name: 'Load more' });

    listShortUrls.mockResolvedValueOnce(
      page(
        Array.from({ length: 40 }, (_, i) => ({
          code: `code${i}`,
          originalUrl: `https://example.com/${i}`,
          createdAt: '2026-09-16T00:00:00.000Z',
          clickCount: 0,
        })),
        45,
        40,
      ),
    );

    await user.click(loadMore);

    await waitFor(() =>
      expect(listShortUrls).toHaveBeenLastCalledWith({ limit: 40, offset: 0 }),
    );
  });
});
