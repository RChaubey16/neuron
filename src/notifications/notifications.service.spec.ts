import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { CreateEmailDto } from './dto/create-email.dto';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let queue: { add: jest.Mock };

  beforeEach(async () => {
    queue = { add: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getQueueToken('email'), useValue: queue },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  it('queues an email job with the fixed retry/backoff policy', async () => {
    queue.add.mockResolvedValue({});
    const dto: CreateEmailDto = {
      to: ['recipient@example.com'],
      subject: 'Hi',
      body: '<p>Hello</p>',
    };

    await service.queueEmail(dto);

    expect(queue.add).toHaveBeenCalledWith('send', dto, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  });
});
