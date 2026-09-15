import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { EmailProcessor } from './email.processor';
import { RESEND_CLIENT } from '../providers/resend-client.provider';
import { CreateEmailDto } from '../dto/create-email.dto';
import { PrismaService } from '../../prisma/prisma.service';

describe('EmailProcessor', () => {
  let processor: EmailProcessor;
  let resend: { emails: { send: jest.Mock } };
  let prisma: { emailJob: { update: jest.Mock } };

  beforeEach(async () => {
    resend = { emails: { send: jest.fn() } };
    prisma = { emailJob: { update: jest.fn() } };
    prisma.emailJob.update.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailProcessor,
        { provide: RESEND_CLIENT, useValue: resend },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'notifications@neuron.test' },
        },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    processor = module.get(EmailProcessor);
  });

  describe('process', () => {
    it('sends the email via Resend with the job payload and returns the delivery id', async () => {
      resend.emails.send.mockResolvedValue({
        data: { id: 'email-1' },
        error: null,
      });
      const job = {
        id: 'job-1',
        data: {
          to: ['recipient@example.com'],
          subject: 'Hi',
          body: '<p>Hello</p>',
        },
      } as Job<CreateEmailDto>;

      const result = await processor.process(job);

      expect(resend.emails.send).toHaveBeenCalledWith({
        from: 'notifications@neuron.test',
        to: ['recipient@example.com'],
        subject: 'Hi',
        html: '<p>Hello</p>',
      });
      expect(result).toEqual({ resendId: 'email-1' });
    });

    it('throws when Resend returns an error result, so BullMQ retries the job', async () => {
      resend.emails.send.mockResolvedValue({
        data: null,
        error: {
          name: 'application_error',
          statusCode: 403,
          message: 'domain is not verified',
        },
      });
      const job = {
        id: 'job-3',
        data: {
          to: ['recipient@example.com'],
          subject: 'Hi',
          body: '<p>Hello</p>',
        },
      } as Job<CreateEmailDto>;

      await expect(processor.process(job)).rejects.toThrow(
        /domain is not verified/,
      );
    });

    it('propagates a genuinely thrown error (e.g. a network exception), as defensive behavior', async () => {
      resend.emails.send.mockRejectedValue(new Error('resend is down'));
      const job = {
        id: 'job-2',
        data: {
          to: ['recipient@example.com'],
          subject: 'Hi',
          body: '<p>Hello</p>',
        },
      } as Job<CreateEmailDto>;

      await expect(processor.process(job)).rejects.toThrow('resend is down');
    });
  });

  describe('onActive', () => {
    it('marks the EmailJob PROCESSING', async () => {
      const job = { id: 'job-1' } as Job<CreateEmailDto>;

      await processor.onActive(job);

      expect(prisma.emailJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { status: 'PROCESSING' },
      });
    });

    it('does nothing if the job has no id', async () => {
      const job = { id: undefined } as Job<CreateEmailDto>;

      await processor.onActive(job);

      expect(prisma.emailJob.update).not.toHaveBeenCalled();
    });

    it('logs an error when the update fails, without throwing (BullMQ never catches a listener rejection)', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      prisma.emailJob.update.mockRejectedValue(new Error('connection reset'));
      const job = { id: 'job-1' } as Job<CreateEmailDto>;

      await expect(processor.onActive(job)).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('job-1'),
        expect.anything(),
      );

      errorSpy.mockRestore();
    });
  });

  describe('onCompleted', () => {
    it('marks the EmailJob SENT with the Resend delivery id', async () => {
      const job = { id: 'job-1' } as Job<CreateEmailDto>;

      await processor.onCompleted(job, { resendId: 'email-1' });

      expect(prisma.emailJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { status: 'SENT', resendId: 'email-1', error: null },
      });
    });

    it('logs an error when the update fails, without throwing', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      prisma.emailJob.update.mockRejectedValue(new Error('connection reset'));
      const job = { id: 'job-1' } as Job<CreateEmailDto>;

      await expect(
        processor.onCompleted(job, { resendId: 'email-1' }),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('job-1'),
        expect.anything(),
      );

      errorSpy.mockRestore();
    });
  });

  describe('onFailed', () => {
    it('marks the EmailJob FAILED once all attempts are exhausted', async () => {
      const job = {
        id: 'job-1',
        attemptsMade: 3,
        opts: { attempts: 3 },
      } as Job<CreateEmailDto>;

      await processor.onFailed(job, new Error('domain is not verified'));

      expect(prisma.emailJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          status: 'FAILED',
          error: 'domain is not verified',
          attemptsMade: 3,
        },
      });
    });

    it('reverts the EmailJob to QUEUED when attempts remain', async () => {
      const job = {
        id: 'job-1',
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as Job<CreateEmailDto>;

      await processor.onFailed(job, new Error('transient error'));

      expect(prisma.emailJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          status: 'QUEUED',
          error: 'transient error',
          attemptsMade: 1,
        },
      });
    });

    it('does nothing if the job is undefined', async () => {
      await processor.onFailed(undefined, new Error('boom'));

      expect(prisma.emailJob.update).not.toHaveBeenCalled();
    });

    it('logs an error when the update fails, without throwing — this is exactly the gap a real run surfaced (EmailJob silently stuck out of sync with a correctly-terminal BullMQ job, with no log trail)', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      prisma.emailJob.update.mockRejectedValue(new Error('connection reset'));
      const job = {
        id: 'job-1',
        attemptsMade: 3,
        opts: { attempts: 3 },
      } as Job<CreateEmailDto>;

      await expect(
        processor.onFailed(job, new Error('domain is not verified')),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('job-1'),
        expect.anything(),
      );

      errorSpy.mockRestore();
    });
  });
});
