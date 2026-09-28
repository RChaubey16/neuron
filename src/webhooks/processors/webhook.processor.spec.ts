import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { UnrecoverableError, type Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { signWebhook } from '../delivery/signing';
import { BlockedTargetError } from '../delivery/target-guard';
import { WEBHOOK_HTTP_CLIENT } from '../delivery/webhook-http-client';
import type { WebhookJobData } from '../providers/webhook-queue.provider';
import { WebhookProcessor } from './webhook.processor';

// Jest's asymmetric matchers are typed `any`; these keep
// no-unsafe-assignment happy when nesting them inside object literals.
const anyOf = <T>(type: new (...args: never[]) => T): T =>
  expect.any(type) as T;
const partial = <T extends object>(value: T): T =>
  expect.objectContaining(value) as T;

const endpoint = {
  id: 'endpoint-1',
  url: 'https://example.com/hooks',
  secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
  disabledAt: null,
  deletedAt: null,
};

const delivery = {
  id: 'delivery-1',
  payload: {
    type: 'email.sent',
    timestamp: '2026-09-28T00:00:00.000Z',
    data: {},
  },
  endpoint,
};

function jobFor(attemptsMade: number): Job<WebhookJobData> {
  return {
    id: 'delivery-1',
    data: { deliveryId: 'delivery-1' },
    attemptsMade,
    opts: { attempts: 6 },
  } as Job<WebhookJobData>;
}

describe('WebhookProcessor', () => {
  let processor: WebhookProcessor;
  let http: { post: jest.Mock };
  let prisma: {
    webhookDelivery: { findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    http = { post: jest.fn().mockResolvedValue({ status: 200 }) };
    prisma = {
      webhookDelivery: {
        findUnique: jest.fn().mockResolvedValue(delivery),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookProcessor,
        { provide: WEBHOOK_HTTP_CLIENT, useValue: http },
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();

    processor = module.get(WebhookProcessor);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('POSTs the payload with valid Standard Webhooks headers and records success', async () => {
    await processor.process(jobFor(0));

    const [url, headers, body, options] = http.post.mock.calls[0] as [
      string,
      Record<string, string>,
      string,
      object,
    ];
    expect(url).toBe('https://example.com/hooks');
    expect(body).toBe(JSON.stringify(delivery.payload));
    expect(headers['webhook-id']).toBe('delivery-1');
    expect(headers['webhook-signature']).toBe(
      signWebhook(
        endpoint.secret,
        'delivery-1',
        Number(headers['webhook-timestamp']),
        body,
      ),
    );
    expect(options).toEqual({ allowPrivateTargets: false });
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: {
        status: 'SUCCEEDED',
        attemptsMade: 1,
        responseStatus: 200,
        error: null,
        lastAttemptAt: anyOf(Date),
      },
    });
  });

  it('keeps a non-2xx attempt PENDING and throws so BullMQ retries', async () => {
    http.post.mockResolvedValue({ status: 503 });

    await expect(processor.process(jobFor(2))).rejects.toThrow(
      'Endpoint responded with HTTP 503',
    );
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: partial({
        status: 'PENDING',
        attemptsMade: 3,
        responseStatus: 503,
      }),
    });
  });

  it('marks the delivery FAILED on the last attempt', async () => {
    http.post.mockRejectedValue(new Error('Timed out after 10s'));

    await expect(processor.process(jobFor(5))).rejects.toThrow(
      'Timed out after 10s',
    );
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: partial({
        status: 'FAILED',
        attemptsMade: 6,
        responseStatus: null,
        error: 'Timed out after 10s',
      }),
    });
  });

  it('fails without retrying when the host resolves to a blocked address', async () => {
    http.post.mockRejectedValue(
      new BlockedTargetError('example.com resolves to a private address'),
    );

    await expect(processor.process(jobFor(0))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: partial({ status: 'FAILED' }),
    });
  });

  it.each([
    [{ deletedAt: new Date() }, 'Endpoint was deleted'],
    [{ disabledAt: new Date() }, 'Endpoint is disabled'],
    [
      { url: 'https://127.0.0.1/hooks' },
      'URL must not point to a private or reserved address',
    ],
  ])(
    'fails without sending or retrying when the endpoint is %o',
    async (override, reason) => {
      prisma.webhookDelivery.findUnique.mockResolvedValue({
        ...delivery,
        endpoint: { ...endpoint, ...override },
      });

      await expect(processor.process(jobFor(0))).rejects.toBeInstanceOf(
        UnrecoverableError,
      );
      expect(http.post).not.toHaveBeenCalled();
      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-1' },
        data: partial({ status: 'FAILED', error: reason }),
      });
    },
  );

  it('does nothing when the delivery no longer exists', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    prisma.webhookDelivery.findUnique.mockResolvedValue(null);

    await expect(processor.process(jobFor(0))).resolves.toBeUndefined();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('does not throw (and so does not re-send) when recording a successful attempt fails', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    prisma.webhookDelivery.update.mockRejectedValue(
      new Error('connection reset'),
    );

    await expect(processor.process(jobFor(0))).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('delivery-1'),
      expect.anything(),
    );
  });
});
