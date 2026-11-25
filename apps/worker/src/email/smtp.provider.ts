import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { DeliveryResult } from '../channels/channel.js';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { MESSAGE_ID_HEADER, type EmailProvider, type OutgoingEmail } from './email-provider.js';

/** Sends email over SMTP with nodemailer. Locally this delivers to Mailpit. */
@Injectable()
export class SmtpProvider implements EmailProvider, OnModuleDestroy {
  readonly name = 'smtp';
  private readonly transport: Transporter<SMTPTransport.SentMessageInfo>;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const user = config.get('SMTP_USER', { infer: true });
    const password = config.get('SMTP_PASSWORD', { infer: true });

    this.transport = createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('SMTP_PORT', { infer: true }),
      secure: config.get('SMTP_SECURE', { infer: true }),
      auth: user && password ? { user, pass: password } : undefined,
      // Reuse connections instead of opening one per email.
      pool: true,
      // nodemailer waits up to 2 minutes by default; a stuck server should fail
      // the job well before that.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  }

  async send(email: OutgoingEmail): Promise<DeliveryResult> {
    const info = await this.transport.sendMail({
      from: email.from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text ?? undefined,
      headers: { [MESSAGE_ID_HEADER]: email.messageId },
    });

    if (info.rejected.length > 0) {
      throw new Error(`SMTP server rejected the recipient: ${info.response}`);
    }
    return { providerMessageId: info.messageId };
  }

  onModuleDestroy(): void {
    this.transport.close();
  }
}
