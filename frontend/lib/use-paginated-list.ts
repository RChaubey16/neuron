import { useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

type ListResponse<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

/**
 * "Load more" pagination: grows `limit` rather than paging via `offset`, so
 * the response's `items` is always the full accumulated list — no
 * client-side merging of separate pages needed.
 */
export function usePaginatedList<T>({
  queryKey,
  queryFn,
  pageSize,
  maxLimit,
}: {
  queryKey: string;
  queryFn: (params: {
    limit: number;
    offset: number;
  }) => Promise<ListResponse<T>>;
  pageSize: number;
  maxLimit: number;
}): {
  query: UseQueryResult<ListResponse<T>>;
  items: T[];
  total: number;
  isLoading: boolean;
  isError: boolean;
  isEmpty: boolean;
  canLoadMore: boolean;
  loadMore: () => void;
} {
  const [limit, setLimit] = useState(pageSize);

  const query = useQuery({
    queryKey: [queryKey, limit],
    queryFn: () => queryFn({ limit, offset: 0 }),
  });

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;

  return {
    query,
    items,
    total,
    isLoading: query.status === 'pending',
    isError: query.status === 'error',
    isEmpty: query.status === 'success' && items.length === 0,
    canLoadMore: items.length < total && limit < maxLimit,
    loadMore: () => setLimit((l) => Math.min(l + pageSize, maxLimit)),
  };
}
