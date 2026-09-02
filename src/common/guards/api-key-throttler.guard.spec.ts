import { createHash } from 'crypto';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorage } from '@nestjs/throttler';
import { Request } from 'express';
import { ApiKeyThrottlerGuard } from './api-key-throttler.guard';

describe('ApiKeyThrottlerGuard', () => {
  const guard = new ApiKeyThrottlerGuard(
    { throttlers: [{ name: 'default', ttl: 60_000, limit: 20 }] },
    {} as unknown as ThrottlerStorage,
    { getAllAndOverride: jest.fn() } as unknown as Reflector,
  );

  // getTracker is protected; cast to access it directly rather than
  // exercising the full canActivate/storage pipeline for a pure function.
  const getTracker = (req: Pick<Request, 'headers' | 'ip'>): Promise<string> =>
    (
      guard as unknown as { getTracker: (req: Request) => Promise<string> }
    ).getTracker(req as Request);

  it('tracks by the hashed x-api-key header when one is present', async () => {
    const tracker = await getTracker({
      headers: { 'x-api-key': 'raw-key' },
      ip: '203.0.113.5',
    });

    expect(tracker).toBe(
      `api-key:${createHash('sha256').update('raw-key').digest('hex')}`,
    );
  });

  it('falls back to the IP tracker when there is no x-api-key header', async () => {
    const tracker = await getTracker({ headers: {}, ip: '203.0.113.5' });

    expect(tracker).toBe('203.0.113.5');
  });

  it('falls back to the IP tracker for a non-string x-api-key header', async () => {
    const tracker = await getTracker({
      headers: { 'x-api-key': ['a', 'b'] },
      ip: '203.0.113.5',
    });

    expect(tracker).toBe('203.0.113.5');
  });
});
