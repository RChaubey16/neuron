import { clearToken, getToken } from './auth-token';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
const HTTP_NO_CONTENT = 204;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 401) {
    // Session JWT missing/expired/invalid — nothing on this dashboard works without it.
    clearToken();
    if (typeof window !== 'undefined') window.location.href = '/';
    throw new ApiError(401, 'Unauthorized');
  }

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new ApiError(response.status, message || response.statusText);
  }

  if (response.status === HTTP_NO_CONTENT) return undefined as T;

  return response.json() as Promise<T>;
}

export type User = {
  id: string;
  email: string;
  createdAt: string;
};

export type ApiKey = {
  id: string;
  keyPrefix: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type CreatedApiKey = ApiKey & { key: string };

export type UsageSummary = {
  service: string;
  date: string;
  apiKeyId: string;
  count: number;
};

export type ShortUrl = {
  code: string;
  originalUrl: string;
  createdAt: string;
  clickCount: number;
};

export type ShortUrlList = {
  items: ShortUrl[];
  total: number;
  limit: number;
  offset: number;
};

export type EmailJobStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'SENT'
  | 'FAILED'
  | 'CANCELLED';

export type EmailJob = {
  id: string;
  status: EmailJobStatus;
  to: string[];
  subject: string;
  error: string | null;
  attemptsMade: number;
  resendId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmailJobList = {
  items: EmailJob[];
  total: number;
  limit: number;
  offset: number;
};

export const api = {
  getMe: () => apiFetch<User>('/me'),

  listApiKeys: () => apiFetch<ApiKey[]>('/api-keys'),

  createApiKey: (name?: string) =>
    apiFetch<CreatedApiKey>('/api-keys', {
      method: 'POST',
      body: JSON.stringify(name ? { name } : {}),
    }),

  revokeApiKey: (id: string) =>
    apiFetch<void>(`/api-keys/${id}`, { method: 'DELETE' }),

  getUsage: () => apiFetch<UsageSummary[]>('/usage'),

  listShortUrls: (params?: { limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) query.set('limit', String(params.limit));
    if (params?.offset !== undefined) query.set('offset', String(params.offset));
    const qs = query.toString();
    return apiFetch<ShortUrlList>(`/short-url${qs ? `?${qs}` : ''}`);
  },

  createShortUrl: (originalUrl: string) =>
    apiFetch<ShortUrl>('/short-url', {
      method: 'POST',
      body: JSON.stringify({ originalUrl }),
    }),

  listEmailJobs: (params?: { limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) query.set('limit', String(params.limit));
    if (params?.offset !== undefined) query.set('offset', String(params.offset));
    const qs = query.toString();
    return apiFetch<EmailJobList>(`/notifications/email${qs ? `?${qs}` : ''}`);
  },

  sendEmail: (payload: { to: string[]; subject: string; body: string }) =>
    apiFetch<EmailJob>('/notifications/email', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  retryEmail: (jobId: string) =>
    apiFetch<EmailJob>(`/notifications/email/${jobId}/retry`, {
      method: 'POST',
    }),

  cancelEmail: (jobId: string) =>
    apiFetch<void>(`/notifications/email/${jobId}`, { method: 'DELETE' }),
};

export function googleSignInUrl(): string {
  return `${API_URL}/auth/google`;
}
