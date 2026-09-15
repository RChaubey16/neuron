import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmailDto } from './dto/create-email.dto';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let queue: { add: jest.Mock; remove: jest.Mock };
  let prisma: {
    emailJob: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  const job = {
    id: 'job-1',
    apiKeyId: 'key-1',
    status: 'QUEUED',
    to: ['recipient@example.com'],
    subject: 'Hi',
    body: '<p>Hello</p>',
    error: null,
    attemptsMade: 0,
    resendId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    queue = { add: jest.fn(), remove: jest.fn() };
    prisma = {
      emailJob: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getQueueToken('email'), useValue: queue },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe('queueEmail', () => {
    it("creates an EmailJob row and queues it under the row's own id", async () => {
      prisma.emailJob.create.mockResolvedValue(job);
      queue.add.mockResolvedValue({});
      const dto: CreateEmailDto = {
        to: ['recipient@example.com'],
        subject: 'Hi',
        body: '<p>Hello</p>',
      };

      const result = await service.queueEmail('key-1', dto);

      expect(prisma.emailJob.create).toHaveBeenCalledWith({
        data: {
          apiKeyId: 'key-1',
          to: dto.to,
          subject: dto.subject,
          body: dto.body,
        },
      });
      expect(queue.add).toHaveBeenCalledWith('send', dto, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 1000, age: 86_400 },
        removeOnFail: { count: 5000 },
        jobId: 'job-1',
      });
      expect(result.id).toBe('job-1');
      expect(result.status).toBe('QUEUED');
    });
  });

  describe('sendTemplatedEmail', () => {
    it("renders a known template and queues it under the created row's own id", async () => {
      prisma.emailJob.create.mockResolvedValue({
        ...job,
        subject: 'Welcome to Neuron, Ada!',
        body: "<p>Hi Ada,</p><p>Thanks for signing up for Neuron. We're glad to have you.</p>",
      });
      queue.add.mockResolvedValue({});

      const result = await service.sendTemplatedEmail('key-1', 'welcome', {
        to: ['recipient@example.com'],
        variables: { name: 'Ada', productName: 'Neuron' },
      });

      expect(prisma.emailJob.create).toHaveBeenCalledWith({
        data: {
          apiKeyId: 'key-1',
          to: ['recipient@example.com'],
          subject: 'Welcome to Neuron, Ada!',
          body: "<p>Hi Ada,</p><p>Thanks for signing up for Neuron. We're glad to have you.</p>",
        },
      });
      expect(queue.add).toHaveBeenCalledWith(
        'send',
        {
          to: ['recipient@example.com'],
          subject: 'Welcome to Neuron, Ada!',
          body: "<p>Hi Ada,</p><p>Thanks for signing up for Neuron. We're glad to have you.</p>",
        },
        expect.objectContaining({ jobId: job.id }),
      );
      expect(result.status).toBe('QUEUED');
    });

    it('throws NotFoundException for an unknown template key', async () => {
      await expect(
        service.sendTemplatedEmail('key-1', 'does-not-exist', {
          to: ['recipient@example.com'],
          variables: {},
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.emailJob.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when variables do not match the template', async () => {
      await expect(
        service.sendTemplatedEmail('key-1', 'welcome', {
          to: ['recipient@example.com'],
          variables: { name: 'Ada' },
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.emailJob.create).not.toHaveBeenCalled();
    });
  });

  describe('listTemplates', () => {
    it('lists every registered template with its required variables', () => {
      const result = service.listTemplates();

      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'welcome',
            requiredVariables: ['name', 'productName'],
          }),
          expect.objectContaining({
            key: 'password-reset',
            requiredVariables: ['name', 'resetUrl', 'expiryMinutes'],
          }),
        ]),
      );
    });
  });

  describe('getStatus', () => {
    it('returns the job when owned by the given API key', async () => {
      prisma.emailJob.findFirst.mockResolvedValue(job);

      const result = await service.getStatus('key-1', 'job-1');

      expect(prisma.emailJob.findFirst).toHaveBeenCalledWith({
        where: { id: 'job-1', apiKeyId: 'key-1' },
      });
      expect(result.id).toBe('job-1');
    });

    it('throws NotFoundException when no job matches the id/apiKeyId pair', async () => {
      prisma.emailJob.findFirst.mockResolvedValue(null);

      await expect(service.getStatus('key-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('retry', () => {
    it('re-queues a FAILED job from its stored payload, resetting attempts', async () => {
      const failedJob = {
        ...job,
        status: 'FAILED',
        error: 'boom',
        attemptsMade: 3,
      };
      const resetJob = {
        ...failedJob,
        status: 'QUEUED',
        error: null,
        attemptsMade: 0,
      };
      prisma.emailJob.findFirst.mockResolvedValue(failedJob);
      prisma.emailJob.update.mockResolvedValue(resetJob);
      queue.remove.mockResolvedValue(1);
      queue.add.mockResolvedValue({});

      const result = await service.retry('key-1', 'job-1');

      expect(prisma.emailJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { status: 'QUEUED', error: null, attemptsMade: 0 },
      });
      // Removes any stale BullMQ job left behind by removeOnFail retention
      // before re-adding under the same jobId, to avoid an id collision.
      expect(queue.remove).toHaveBeenCalledWith('job-1');
      expect(queue.add).toHaveBeenCalledWith(
        'send',
        { to: resetJob.to, subject: resetJob.subject, body: resetJob.body },
        expect.objectContaining({ jobId: 'job-1' }),
      );
      expect(result.status).toBe('QUEUED');
    });

    it('throws ConflictException when the job is not FAILED', async () => {
      prisma.emailJob.findFirst.mockResolvedValue({ ...job, status: 'SENT' });

      await expect(service.retry('key-1', 'job-1')).rejects.toThrow(
        ConflictException,
      );
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when not owned by the given API key', async () => {
      prisma.emailJob.findFirst.mockResolvedValue(null);

      await expect(service.retry('key-1', 'job-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cancel', () => {
    it('removes a QUEUED job from BullMQ and marks it CANCELLED', async () => {
      prisma.emailJob.findFirst.mockResolvedValue(job);
      queue.remove.mockResolvedValue(1);
      prisma.emailJob.updateMany.mockResolvedValue({ count: 1 });

      await service.cancel('key-1', 'job-1');

      expect(queue.remove).toHaveBeenCalledWith('job-1');
      expect(prisma.emailJob.updateMany).toHaveBeenCalledWith({
        where: { id: 'job-1', status: 'QUEUED' },
        data: { status: 'CANCELLED' },
      });
    });

    it('throws ConflictException when the job is not QUEUED', async () => {
      prisma.emailJob.findFirst.mockResolvedValue({
        ...job,
        status: 'PROCESSING',
      });

      await expect(service.cancel('key-1', 'job-1')).rejects.toThrow(
        ConflictException,
      );
      expect(queue.remove).not.toHaveBeenCalled();
    });

    it('throws ConflictException when BullMQ reports the job already started (race)', async () => {
      prisma.emailJob.findFirst.mockResolvedValue(job);
      queue.remove.mockResolvedValue(0);

      await expect(service.cancel('key-1', 'job-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.emailJob.updateMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when not owned by the given API key', async () => {
      prisma.emailJob.findFirst.mockResolvedValue(null);

      await expect(service.cancel('key-1', 'job-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
