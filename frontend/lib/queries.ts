import { queryOptions } from '@tanstack/react-query';
import { api } from './api';

// Shared definitions for queries used on more than one page, so their cache
// policy lives in one place. Everything else keeps React Query's default
// (always refetch on mount/focus) because it reflects server-side activity
// the dashboard doesn't cause itself: clicks, job statuses, key lastUsedAt.

/** The signed-in user's profile never changes during a session. */
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: api.getMe,
  staleTime: Infinity,
});

/**
 * Templates are code-defined on the backend and only change with a deploy,
 * so there's no point refetching them on every visit; a reload picks up new
 * ones.
 */
export const emailTemplatesQuery = queryOptions({
  queryKey: ['email-templates'],
  queryFn: api.listEmailTemplates,
  staleTime: Infinity,
});
