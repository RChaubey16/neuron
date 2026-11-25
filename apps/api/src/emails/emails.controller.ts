import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { ApiKey } from '@neuron/db';
import { ApiKeyGuard } from '../api-keys/api-key.guard.js';
import { CurrentApiKey } from '../api-keys/current-api-key.decorator.js';
import type { SendEmailResponse } from './emails.service.js';
import { EmailsService } from './emails.service.js';
import { SendEmailDto } from './send-email.dto.js';

@Controller('v1/emails')
@UseGuards(ApiKeyGuard)
export class EmailsController {
  constructor(private readonly emails: EmailsService) {}

  /** Accepts an email for sending. 202: it's queued, not sent yet. */
  @Post()
  @HttpCode(202)
  send(@CurrentApiKey() apiKey: ApiKey, @Body() body: SendEmailDto): Promise<SendEmailResponse> {
    return this.emails.send(apiKey, body);
  }
}
