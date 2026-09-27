import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, describeError } from './api';

function mockFetchOnce(status: number, body: string) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(body, { status, statusText: 'Bad Request' }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apiFetch error messages', () => {
  it("uses the backend's JSON `message` field", async () => {
    mockFetchOnce(
      409,
      JSON.stringify({ statusCode: 409, message: 'Only FAILED jobs can be retried' }),
    );

    await expect(api.retryEmail('job-1')).rejects.toMatchObject({
      status: 409,
      message: 'Only FAILED jobs can be retried',
    });
  });

  it('joins class-validator message arrays', async () => {
    mockFetchOnce(
      400,
      JSON.stringify({
        statusCode: 400,
        message: ['to must be an array', 'subject should not be empty'],
      }),
    );

    await expect(api.getUsage()).rejects.toMatchObject({
      message: 'to must be an array. subject should not be empty',
    });
  });

  it('falls back to the raw body when it is not JSON', async () => {
    mockFetchOnce(502, 'Bad Gateway');

    await expect(api.getUsage()).rejects.toMatchObject({ message: 'Bad Gateway' });
  });
});

describe('describeError', () => {
  it("returns an ApiError's message", () => {
    expect(describeError(new ApiError(404, 'API key not found'))).toBe(
      'API key not found',
    );
  });

  it('returns a generic message for network failures', () => {
    expect(describeError(new TypeError('Failed to fetch'))).toBe(
      "Couldn't reach the server. Check your connection and try again.",
    );
  });
});
