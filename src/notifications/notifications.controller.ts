import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiKeyGuard } from '../api-keys/guards/api-key.guard';
import { CurrentApiKey } from '../api-keys/decorators/current-api-key.decorator';
import { Service } from '../usage/decorators/service.decorator';
import { UsageLoggingInterceptor } from '../usage/interceptors/usage-logging.interceptor';
import { NotificationsService } from './notifications.service';
import { CreateEmailDto } from './dto/create-email.dto';
import { EmailJobParamsDto } from './dto/email-job-params.dto';
import { EmailJobResponseDto } from './dto/email-job-response.dto';
import { SendTemplatedEmailDto } from './dto/send-templated-email.dto';
import { TemplateKeyParamsDto } from './dto/template-key-params.dto';
import { EmailTemplateSummaryDto } from './dto/email-template-summary.dto';
import type { ApiKey } from '../../generated/prisma';

@Controller('api/v1/notifications/email')
@UseGuards(ApiKeyGuard)
@UseInterceptors(UsageLoggingInterceptor)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // @Service() stays per-method (not hoisted to the class) because
  // UsageLoggingInterceptor reads it via `reflector.get(SERVICE_KEY,
  // context.getHandler())`, which only inspects the method, not the
  // controller class.

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Service('email-notifications')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  send(
    @CurrentApiKey() apiKey: ApiKey,
    @Body() dto: CreateEmailDto,
  ): Promise<EmailJobResponseDto> {
    return this.notificationsService.queueEmail(apiKey.id, dto);
  }

  // 'templates' routes are registered ahead of GET/POST ':jobId' routes —
  // Express matches routes in registration order, not by specificity, so
  // 'templates' would otherwise be captured as a (non-UUID, 400) jobId.

  @Get('templates')
  @Service('email-notifications')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  listTemplates(): EmailTemplateSummaryDto[] {
    return this.notificationsService.listTemplates();
  }

  @Post('templates/:templateKey/send')
  @HttpCode(HttpStatus.ACCEPTED)
  @Service('email-notifications')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  sendTemplated(
    @CurrentApiKey() apiKey: ApiKey,
    @Param() params: TemplateKeyParamsDto,
    @Body() dto: SendTemplatedEmailDto,
  ): Promise<EmailJobResponseDto> {
    return this.notificationsService.sendTemplatedEmail(
      apiKey.id,
      params.templateKey,
      dto,
    );
  }

  @Get(':jobId')
  @Service('email-notifications')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getStatus(
    @CurrentApiKey() apiKey: ApiKey,
    @Param() params: EmailJobParamsDto,
  ): Promise<EmailJobResponseDto> {
    return this.notificationsService.getStatus(apiKey.id, params.jobId);
  }

  @Post(':jobId/retry')
  @HttpCode(HttpStatus.OK)
  @Service('email-notifications')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  retry(
    @CurrentApiKey() apiKey: ApiKey,
    @Param() params: EmailJobParamsDto,
  ): Promise<EmailJobResponseDto> {
    return this.notificationsService.retry(apiKey.id, params.jobId);
  }

  @Delete(':jobId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Service('email-notifications')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  cancel(
    @CurrentApiKey() apiKey: ApiKey,
    @Param() params: EmailJobParamsDto,
  ): Promise<void> {
    return this.notificationsService.cancel(apiKey.id, params.jobId);
  }
}
