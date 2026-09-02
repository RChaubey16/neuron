import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { EmailProcessor } from './email.processor';
import { RESEND_CLIENT } from './resend-client.provider';
import { CreateEmailDto } from './dto/create-email.dto';

describe('EmailProcessor', () => {
  let processor: EmailProcessor;
  let resend: { emails: { send: jest.Mock } };

  beforeEach(async () => {
    resend = { emails: { send: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailProcessor,
        { provide: RESEND_CLIENT, useValue: resend },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 'notifications@neuron.test' },
        },
      ],
    }).compile();

    processor = module.get(EmailProcessor);
  });

  it('sends the email via Resend with the job payload', async () => {
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

    await processor.process(job);

    expect(resend.emails.send).toHaveBeenCalledWith({
      from: 'notifications@neuron.test',
      to: ['recipient@example.com'],
      subject: 'Hi',
      html: '<p>Hello</p>',
    });
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
