import { Inject, Injectable } from '@nestjs/common';
import type { Message } from '@neuron/db';
import type { Channel, DeliveryResult } from '../channels/channel.js';
import { EMAIL_PROVIDER, type EmailProvider } from './email-provider.js';

/** Delivers messages as email through the configured EmailProvider. */
@Injectable()
export class EmailChannel implements Channel {
  readonly name = 'email';

  constructor(@Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider) {}

  deliver(message: Message): Promise<DeliveryResult> {
    return this.provider.send({
      messageId: message.id,
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  }
}
