import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { WEBHOOK_QUEUE } from './providers/webhook-queue.provider';
import { MAX_ENDPOINTS_PER_USER, WebhooksService } from './webhooks.service';

// Jest's asymmetric matchers are typed `any`; these keep
// no-unsafe-assignment happy when nesting them inside object literals.
const anyOf = <T>(type: new (...args: never[]) => T): T =>
  expect.any(type) as T;
const partial = <T extends object>(value: T): T =>
  expect.objectContaining(value) as T;

const baseEndpoint = {
  id: 'endpoint-1',
  userId: 'user-1',
  url: 'https://example.com/hooks',
  description: null,
  events: ['email.sent'],
  secret: 'whsec_c2VjcmV0',
  disabledAt: null,
  deletedAt: null,
  createdAt: new Date('2026-09-28T00:00:00Z'),
  updatedAt: new Date('2026-09-28T00:00:00Z'),
};

const baseDelivery = {
  id: 'delivery-1',
  endpointId: 'endpoint-1',
  userId: 'user-1',
  eventType: 'email.sent',
  payload: { type: 'email.sent' },
  status: 'FAILED',
  attemptsMade: 6,
  responseStatus: 500,
  error: 'Endpoint responded with HTTP 500',
  lastAttemptAt: new Date('2026-09-28T00:10:00Z'),
  createdAt: new Date('2026-09-28T00:00:00Z'),
  updatedAt: new Date('2026-09-28T00:10:00Z'),
};

describe('WebhooksService', () => {
  let service: WebhooksService;
  let prisma: {
    webhookEndpoint: Record<
      'count' | 'create' | 'findMany' | 'findFirst' | 'update',
      jest.Mock
    >;
    webhookDelivery: Record<
      | 'create'
      | 'createMany'
      | 'findMany'
      | 'findFirst'
      | 'count'
      | 'update'
      | 'updateMany',
      jest.Mock
    >;
  };
  let queue: { addBulk: jest.Mock; remove: jest.Mock };

  async function build(allowPrivateTargets = false) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: prisma },
        { provide: WEBHOOK_QUEUE, useValue: queue },
        {
          provide: ConfigService,
          useValue: {
            get: () => (allowPrivateTargets ? 'true' : undefined),
          },
        },
      ],
    }).compile();
    service = module.get(WebhooksService);
  }

  beforeEach(async () => {
    prisma = {
      webhookEndpoint: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue(baseEndpoint),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(baseEndpoint),
        update: jest.fn().mockResolvedValue(baseEndpoint),
      },
      webhookDelivery: {
        create: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    queue = {
      addBulk: jest.fn().mockResolvedValue([]),
      remove: jest.fn().mockResolvedValue(1),
    };
    await build();
  });

  describe('createEndpoint', () => {
    it('creates the endpoint with a generated whsec_ secret and returns it once', async () => {
      prisma.webhookEndpoint.create.mockImplementation(
        ({ data }: { data: object }) =>
          Promise.resolve({ ...baseEndpoint, ...data }),
      );

      const result = await service.createEndpoint('user-1', {
        url: 'https://example.com/hooks',
        events: ['email.sent'],
      });

      const { data } = (
        prisma.webhookEndpoint.create.mock.calls[0] as unknown[]
      )[0] as {
        data: { secret: string };
      };
      expect(data).toMatchObject({
        userId: 'user-1',
        url: 'https://example.com/hooks',
        events: ['email.sent'],
      });
      expect(data.secret).toMatch(/^whsec_/);
      expect(result.secret).toBe(data.secret);
      expect(result.enabled).toBe(true);
    });

    it('rejects a disallowed target URL before touching the database', async () => {
      await expect(
        service.createEndpoint('user-1', {
          url: 'http://example.com/hooks',
          events: ['email.sent'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.webhookEndpoint.create).not.toHaveBeenCalled();
    });

    it('allows http/localhost when WEBHOOKS_ALLOW_PRIVATE_TARGETS is true', async () => {
      await build(true);

      await expect(
        service.createEndpoint('user-1', {
          url: 'http://localhost:4000/hooks',
          events: ['email.sent'],
        }),
      ).resolves.toBeDefined();
    });

    it('rejects once the user has the maximum number of live endpoints', async () => {
      prisma.webhookEndpoint.count.mockResolvedValue(MAX_ENDPOINTS_PER_USER);

      await expect(
        service.createEndpoint('user-1', {
          url: 'https://example.com/hooks',
          events: ['email.sent'],
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.webhookEndpoint.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', deletedAt: null },
      });
    });
  });

  describe('endpoint ownership', () => {
    it('never returns the secret from list/get', async () => {
      prisma.webhookEndpoint.findMany.mockResolvedValue([baseEndpoint]);

      const [listed] = await service.listEndpoints('user-1');
      const fetched = await service.getEndpoint('user-1', 'endpoint-1');

      expect(listed).not.toHaveProperty('secret');
      expect(fetched).not.toHaveProperty('secret');
    });

    it('scopes lookups to the user and live endpoints, 404ing otherwise', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue(null);

      await expect(service.getEndpoint('user-2', 'endpoint-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.webhookEndpoint.findFirst).toHaveBeenCalledWith({
        where: { id: 'endpoint-1', userId: 'user-2', deletedAt: null },
      });
    });
  });

  describe('updateEndpoint', () => {
    it('disables by setting disabledAt, and re-enables by clearing it', async () => {
      await service.updateEndpoint('user-1', 'endpoint-1', { enabled: false });
      expect(prisma.webhookEndpoint.update).toHaveBeenLastCalledWith({
        where: { id: 'endpoint-1' },
        data: partial({ disabledAt: anyOf(Date) }),
      });

      await service.updateEndpoint('user-1', 'endpoint-1', { enabled: true });
      expect(prisma.webhookEndpoint.update).toHaveBeenLastCalledWith({
        where: { id: 'endpoint-1' },
        data: partial({ disabledAt: null }),
      });
    });

    it('leaves disabledAt untouched when enabled is omitted', async () => {
      await service.updateEndpoint('user-1', 'endpoint-1', {
        description: 'Prod',
      });

      expect(prisma.webhookEndpoint.update).toHaveBeenCalledWith({
        where: { id: 'endpoint-1' },
        data: {
          url: undefined,
          description: 'Prod',
          events: undefined,
          disabledAt: undefined,
        },
      });
    });

    it('rejects a disallowed new URL', async () => {
      await expect(
        service.updateEndpoint('user-1', 'endpoint-1', {
          url: 'https://169.254.169.254/latest',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.webhookEndpoint.update).not.toHaveBeenCalled();
    });
  });

  it('deleteEndpoint soft-deletes', async () => {
    await service.deleteEndpoint('user-1', 'endpoint-1');

    expect(prisma.webhookEndpoint.update).toHaveBeenCalledWith({
      where: { id: 'endpoint-1' },
      data: { deletedAt: anyOf(Date) },
    });
  });

  it('rotateSecret stores and returns a new secret', async () => {
    prisma.webhookEndpoint.update.mockImplementation(
      ({ data }: { data: object }) =>
        Promise.resolve({ ...baseEndpoint, ...data }),
    );

    const result = await service.rotateSecret('user-1', 'endpoint-1');

    expect(result.secret).toMatch(/^whsec_/);
    expect(result.secret).not.toBe(baseEndpoint.secret);
  });

  describe('sendTestEvent', () => {
    it('creates a webhook.test delivery and queues it', async () => {
      prisma.webhookDelivery.create.mockImplementation(
        ({ data }: { data: object }) =>
          Promise.resolve({ ...baseDelivery, status: 'PENDING', ...data }),
      );

      const result = await service.sendTestEvent('user-1', 'endpoint-1');

      expect(result.eventType).toBe('webhook.test');
      expect(queue.addBulk).toHaveBeenCalledWith([
        expect.objectContaining({
          data: { deliveryId: result.id },
          opts: partial({ jobId: result.id, attempts: 6 }),
        }),
      ]);
    });

    it('rejects for a disabled endpoint', async () => {
      prisma.webhookEndpoint.findFirst.mockResolvedValue({
        ...baseEndpoint,
        disabledAt: new Date(),
      });

      await expect(
        service.sendTestEvent('user-1', 'endpoint-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('marks the delivery FAILED and returns 503 when the queue is down', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
      prisma.webhookDelivery.create.mockResolvedValue({
        ...baseDelivery,
        status: 'PENDING',
      });
      queue.addBulk.mockRejectedValue(new Error("Stream isn't writeable"));

      await expect(
        service.sendTestEvent('user-1', 'endpoint-1'),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(prisma.webhookDelivery.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['delivery-1'] } },
        data: { status: 'FAILED', error: 'Could not be queued for delivery' },
      });
    });
  });

  describe('listDeliveries', () => {
    it('scopes by user and optional endpoint, with pagination', async () => {
      prisma.webhookDelivery.findMany.mockResolvedValue([baseDelivery]);
      prisma.webhookDelivery.count.mockResolvedValue(1);

      const result = await service.listDeliveries('user-1', {
        endpointId: 'endpoint-1',
        limit: 20,
        offset: 0,
      });

      const where = { userId: 'user-1', endpointId: 'endpoint-1' };
      expect(prisma.webhookDelivery.findMany).toHaveBeenCalledWith({
        where,
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 0,
      });
      expect(result).toMatchObject({ total: 1, limit: 20, offset: 0 });
      expect(result.items[0].id).toBe('delivery-1');
    });
  });

  describe('retryDelivery', () => {
    beforeEach(() => {
      prisma.webhookDelivery.findFirst.mockResolvedValue({
        ...baseDelivery,
        endpoint: baseEndpoint,
      });
      prisma.webhookDelivery.update.mockResolvedValue({
        ...baseDelivery,
        status: 'PENDING',
        attemptsMade: 0,
        error: null,
      });
    });

    it('resets a FAILED delivery (guarded by status), removes the old job and re-queues it under the same id', async () => {
      const result = await service.retryDelivery('user-1', 'delivery-1');

      expect(prisma.webhookDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-1', status: 'FAILED' },
        data: { status: 'PENDING', error: null, attemptsMade: 0 },
      });
      expect(queue.remove).toHaveBeenCalledWith('delivery-1');
      expect(queue.addBulk).toHaveBeenCalledWith([
        expect.objectContaining({
          opts: partial({ jobId: 'delivery-1' }),
        }),
      ]);
      expect(result.status).toBe('PENDING');
    });

    it('404s for a delivery the user does not own', async () => {
      prisma.webhookDelivery.findFirst.mockResolvedValue(null);

      await expect(
        service.retryDelivery('user-2', 'delivery-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.webhookDelivery.findFirst).toHaveBeenCalledWith({
        where: { id: 'delivery-1', userId: 'user-2' },
        include: { endpoint: true },
      });
    });

    it('rejects a delivery that is not FAILED', async () => {
      prisma.webhookDelivery.findFirst.mockResolvedValue({
        ...baseDelivery,
        status: 'SUCCEEDED',
        endpoint: baseEndpoint,
      });

      await expect(
        service.retryDelivery('user-1', 'delivery-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a delivery whose endpoint was deleted', async () => {
      prisma.webhookDelivery.findFirst.mockResolvedValue({
        ...baseDelivery,
        endpoint: { ...baseEndpoint, deletedAt: new Date() },
      });

      await expect(
        service.retryDelivery('user-1', 'delivery-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('maps a lost race (P2025 on the guarded update) to a conflict', async () => {
      prisma.webhookDelivery.update.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.retryDelivery('user-1', 'delivery-1'),
      ).rejects.toThrow(ConflictException);
      expect(queue.addBulk).not.toHaveBeenCalled();
    });

    it('marks the delivery FAILED again and returns 503 when Redis is down', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
      queue.remove.mockRejectedValue(new Error('Connection is closed'));

      await expect(
        service.retryDelivery('user-1', 'delivery-1'),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(prisma.webhookDelivery.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['delivery-1'] } },
        data: { status: 'FAILED', error: 'Could not be queued for delivery' },
      });
    });
  });

  describe('emit', () => {
    it('creates one delivery per subscribed, enabled, live endpoint and queues them', async () => {
      prisma.webhookEndpoint.findMany.mockResolvedValue([
        { id: 'endpoint-1' },
        { id: 'endpoint-2' },
      ]);

      await service.emit('user-1', 'email.sent', { id: 'job-1' });

      expect(prisma.webhookEndpoint.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          deletedAt: null,
          disabledAt: null,
          events: { has: 'email.sent' },
        },
        select: { id: true },
      });
      const { data } = (
        prisma.webhookDelivery.createMany.mock.calls[0] as unknown[]
      )[0] as {
        data: { id: string; endpointId: string; payload: object }[];
      };
      expect(data.map((d) => d.endpointId)).toEqual([
        'endpoint-1',
        'endpoint-2',
      ]);
      expect(data[0].payload).toEqual({
        type: 'email.sent',
        timestamp: anyOf(String),
        data: { id: 'job-1' },
      });
      expect(data[0].payload).toEqual(data[1].payload);
      expect(queue.addBulk).toHaveBeenCalledWith(
        data.map((d) =>
          partial({
            data: { deliveryId: d.id },
            opts: partial({ jobId: d.id }),
          }),
        ),
      );
    });

    it('does nothing when no endpoint is subscribed', async () => {
      await service.emit('user-1', 'email.failed', { id: 'job-1' });

      expect(prisma.webhookDelivery.createMany).not.toHaveBeenCalled();
      expect(queue.addBulk).not.toHaveBeenCalled();
    });

    it('never throws, logging database failures instead', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      prisma.webhookEndpoint.findMany.mockRejectedValue(
        new Error('connection reset'),
      );

      await expect(
        service.emit('user-1', 'email.sent', { id: 'job-1' }),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalled();
    });

    it('marks deliveries FAILED when they could not be queued, without throwing', async () => {
      jest.spyOn(Logger.prototype, 'error').mockImplementation();
      prisma.webhookEndpoint.findMany.mockResolvedValue([{ id: 'endpoint-1' }]);
      queue.addBulk.mockRejectedValue(new Error('Connection is closed'));

      await expect(
        service.emit('user-1', 'email.sent', { id: 'job-1' }),
      ).resolves.toBeUndefined();
      expect(prisma.webhookDelivery.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [anyOf(String)] } },
        data: { status: 'FAILED', error: 'Could not be queued for delivery' },
      });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});
