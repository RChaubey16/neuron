import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiKeyGuard } from '../api-keys/guards/api-key.guard';
import { CurrentApiKey } from '../api-keys/decorators/current-api-key.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Service } from '../usage/decorators/service.decorator';
import { UsageLoggingInterceptor } from '../usage/interceptors/usage-logging.interceptor';
import { NotificationsService } from './notifications.service';
import { CreateEmailDto } from './dto/create-email.dto';
import { EmailJobParamsDto } from './dto/email-job-params.dto';
import { EmailJobResponseDto } from './dto/email-job-response.dto';
import { EmailJobListResponseDto } from './dto/email-job-list-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { SendTemplatedEmailDto } from './dto/send-templated-email.dto';
import { TemplateKeyParamsDto } from './dto/template-key-params.dto';
import { EmailTemplateSummaryDto } from './dto/email-template-summary.dto';
import { EmailTemplatePreviewDto } from './dto/email-template-preview.dto';
import type { ApiKey, User } from '../../generated/prisma';

// No class-level @Controller() prefix/guards (unlike this controller's
// previous shape) — dashboard routes below need to stay unversioned at the
// root while the machine-facing routes stay versioned under
// api/v1/notifications/email, so each route declares its own full path and
// guards, matching ShortUrlController's convention.
@Controller()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('api/v1/notifications/email')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ApiKeyGuard)
  @Service('email-notifications')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  send(
    @CurrentApiKey() apiKey: ApiKey,
    @Body() dto: CreateEmailDto,
  ): Promise<EmailJobResponseDto> {
    return this.notificationsService.queueEmail(
      { userId: apiKey.userId, apiKeyId: apiKey.id },
      dto,
    );
  }

  // 'templates' routes are registered ahead of GET/POST ':jobId' routes —
  // Express matches routes in registration order, not by specificity, so
  // 'templates' would otherwise be captured as a (non-UUID, 400) jobId.

  @Get('api/v1/notifications/email/templates')
  @UseGuards(ApiKeyGuard)
  @Service('email-notifications')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  listTemplates(): EmailTemplateSummaryDto[] {
    return this.notificationsService.listTemplates();
  }

  @Post('api/v1/notifications/email/templates/:templateKey/send')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ApiKeyGuard)
  @Service('email-notifications')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  sendTemplated(
    @CurrentApiKey() apiKey: ApiKey,
    @Param() params: TemplateKeyParamsDto,
    @Body() dto: SendTemplatedEmailDto,
  ): Promise<EmailJobResponseDto> {
    return this.notificationsService.sendTemplatedEmail(
      { userId: apiKey.userId, apiKeyId: apiKey.id },
      params.templateKey,
      dto,
    );
  }

  @Get('api/v1/notifications/email/:jobId')
  @UseGuards(ApiKeyGuard)
  @Service('email-notifications')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getStatus(
    @CurrentApiKey() apiKey: ApiKey,
    @Param() params: EmailJobParamsDto,
  ): Promise<EmailJobResponseDto> {
    return this.notificationsService.getStatus(apiKey.id, params.jobId);
  }

  @Post('api/v1/notifications/email/:jobId/retry')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @Service('email-notifications')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  retry(
    @CurrentApiKey() apiKey: ApiKey,
    @Param() params: EmailJobParamsDto,
  ): Promise<EmailJobResponseDto> {
    return this.notificationsService.retry(apiKey.id, params.jobId);
  }

  @Delete('api/v1/notifications/email/:jobId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ApiKeyGuard)
  @Service('email-notifications')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  cancel(
    @CurrentApiKey() apiKey: ApiKey,
    @Param() params: EmailJobParamsDto,
  ): Promise<void> {
    return this.notificationsService.cancel(apiKey.id, params.jobId);
  }

  // Dashboard routes (JwtAuthGuard, unversioned) — mirror
  // ShortUrlController's GET/POST '/short-url' pair.

  // No @Service()/UsageLoggingInterceptor — this only reads static,
  // code-defined template data and never touches the queue/Resend, so
  // there's no service usage to log, matching findAllForUser below.
  @Get('notifications/templates')
  @UseGuards(JwtAuthGuard)
  previewTemplates(): EmailTemplatePreviewDto[] {
    return this.notificationsService.previewTemplates();
  }

  @Get('notifications/email')
  @UseGuards(JwtAuthGuard)
  findAllForUser(
    @CurrentUser() user: User,
    @Query() query: PaginationQueryDto,
  ): Promise<EmailJobListResponseDto> {
    return this.notificationsService.findAllForUser(
      user.id,
      query.limit,
      query.offset,
    );
  }

  // Dashboard-native counterpart to POST /api/v1/notifications/email: calls
  // the same service method directly with the logged-in user's id, no
  // second guard or fabricated ApiKey involved (see
  // docs/2026-09-17-direct-ownership-design.md).
  @Post('notifications/email')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  @Service('email-notifications')
  @UseInterceptors(UsageLoggingInterceptor)
  sendFromDashboard(
    @CurrentUser() user: User,
    @Body() dto: CreateEmailDto,
  ): Promise<EmailJobResponseDto> {
    return this.notificationsService.queueEmail({ userId: user.id }, dto);
  }

  // Dashboard-native counterpart to
  // POST /api/v1/notifications/email/templates/:templateKey/send, mirroring
  // sendFromDashboard above.
  @Post('notifications/email/templates/:templateKey/send')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  @Service('email-notifications')
  @UseInterceptors(UsageLoggingInterceptor)
  sendTemplatedFromDashboard(
    @CurrentUser() user: User,
    @Param() params: TemplateKeyParamsDto,
    @Body() dto: SendTemplatedEmailDto,
  ): Promise<EmailJobResponseDto> {
    return this.notificationsService.sendTemplatedEmail(
      { userId: user.id },
      params.templateKey,
      dto,
    );
  }

  // Dashboard actions on an existing job. No DashboardApiKeyGuard here —
  // unlike sendFromDashboard, these act across every job the user owns, not
  // just dashboard-originated ones, since a dashboard user should be able to
  // retry/cancel a job created by any of their real API keys too. Usage
  // logging still applies: UsageLoggingInterceptor resolves identity from
  // request.user?.id ?? request.apiKey?.userId, so it works here off
  // request.user alone with no guard/apiKey needed, matching every other
  // dashboard-native route in this file.

  @Post('notifications/email/:jobId/retry')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Service('email-notifications')
  @UseInterceptors(UsageLoggingInterceptor)
  retryFromDashboard(
    @CurrentUser() user: User,
    @Param() params: EmailJobParamsDto,
  ): Promise<EmailJobResponseDto> {
    return this.notificationsService.retryForUser(user.id, params.jobId);
  }

  @Delete('notifications/email/:jobId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @Service('email-notifications')
  @UseInterceptors(UsageLoggingInterceptor)
  cancelFromDashboard(
    @CurrentUser() user: User,
    @Param() params: EmailJobParamsDto,
  ): Promise<void> {
    return this.notificationsService.cancelForUser(user.id, params.jobId);
  }
}
