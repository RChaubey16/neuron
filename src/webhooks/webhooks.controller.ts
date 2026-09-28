import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { WebhooksService } from './webhooks.service';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';
import { UpdateWebhookEndpointDto } from './dto/update-webhook-endpoint.dto';
import { WebhookEndpointParamsDto } from './dto/webhook-endpoint-params.dto';
import { WebhookDeliveryParamsDto } from './dto/webhook-delivery-params.dto';
import { WebhookDeliveryQueryDto } from './dto/webhook-delivery-query.dto';
import { WebhookEndpointResponseDto } from './dto/webhook-endpoint-response.dto';
import { WebhookEndpointWithSecretResponseDto } from './dto/webhook-endpoint-with-secret-response.dto';
import { WebhookDeliveryResponseDto } from './dto/webhook-delivery-response.dto';
import { WebhookDeliveryListResponseDto } from './dto/webhook-delivery-list-response.dto';
import type { ApiKey, User } from '../../generated/prisma';

// Endpoints belong to a user, not a key, so machine routes scope by the
// calling key's userId — any of the user's keys can manage them — and
// both halves below call the exact same service methods. Each route
// declares its own full path and guards, matching the other controllers.
@Controller()
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  // Machine routes (ApiKeyGuard, versioned).

  @Post('api/v1/webhooks/endpoints')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ApiKeyGuard)
  @Service('webhooks')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createEndpoint(
    @CurrentApiKey() apiKey: ApiKey,
    @Body() dto: CreateWebhookEndpointDto,
  ): Promise<WebhookEndpointWithSecretResponseDto> {
    return this.webhooksService.createEndpoint(apiKey.userId, dto);
  }

  @Get('api/v1/webhooks/endpoints')
  @UseGuards(ApiKeyGuard)
  @Service('webhooks')
  @UseInterceptors(UsageLoggingInterceptor)
  listEndpoints(
    @CurrentApiKey() apiKey: ApiKey,
  ): Promise<WebhookEndpointResponseDto[]> {
    return this.webhooksService.listEndpoints(apiKey.userId);
  }

  @Get('api/v1/webhooks/endpoints/:endpointId')
  @UseGuards(ApiKeyGuard)
  @Service('webhooks')
  @UseInterceptors(UsageLoggingInterceptor)
  getEndpoint(
    @CurrentApiKey() apiKey: ApiKey,
    @Param() params: WebhookEndpointParamsDto,
  ): Promise<WebhookEndpointResponseDto> {
    return this.webhooksService.getEndpoint(apiKey.userId, params.endpointId);
  }

  @Patch('api/v1/webhooks/endpoints/:endpointId')
  @UseGuards(ApiKeyGuard)
  @Service('webhooks')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  updateEndpoint(
    @CurrentApiKey() apiKey: ApiKey,
    @Param() params: WebhookEndpointParamsDto,
    @Body() dto: UpdateWebhookEndpointDto,
  ): Promise<WebhookEndpointResponseDto> {
    return this.webhooksService.updateEndpoint(
      apiKey.userId,
      params.endpointId,
      dto,
    );
  }

  @Delete('api/v1/webhooks/endpoints/:endpointId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ApiKeyGuard)
  @Service('webhooks')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  deleteEndpoint(
    @CurrentApiKey() apiKey: ApiKey,
    @Param() params: WebhookEndpointParamsDto,
  ): Promise<void> {
    return this.webhooksService.deleteEndpoint(
      apiKey.userId,
      params.endpointId,
    );
  }

  @Post('api/v1/webhooks/endpoints/:endpointId/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @Service('webhooks')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  rotateSecret(
    @CurrentApiKey() apiKey: ApiKey,
    @Param() params: WebhookEndpointParamsDto,
  ): Promise<WebhookEndpointWithSecretResponseDto> {
    return this.webhooksService.rotateSecret(apiKey.userId, params.endpointId);
  }

  @Post('api/v1/webhooks/endpoints/:endpointId/test')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ApiKeyGuard)
  @Service('webhooks')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  sendTestEvent(
    @CurrentApiKey() apiKey: ApiKey,
    @Param() params: WebhookEndpointParamsDto,
  ): Promise<WebhookDeliveryResponseDto> {
    return this.webhooksService.sendTestEvent(apiKey.userId, params.endpointId);
  }

  @Get('api/v1/webhooks/deliveries')
  @UseGuards(ApiKeyGuard)
  @Service('webhooks')
  @UseInterceptors(UsageLoggingInterceptor)
  listDeliveries(
    @CurrentApiKey() apiKey: ApiKey,
    @Query() query: WebhookDeliveryQueryDto,
  ): Promise<WebhookDeliveryListResponseDto> {
    return this.webhooksService.listDeliveries(apiKey.userId, query);
  }

  @Post('api/v1/webhooks/deliveries/:deliveryId/retry')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ApiKeyGuard)
  @Service('webhooks')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  retryDelivery(
    @CurrentApiKey() apiKey: ApiKey,
    @Param() params: WebhookDeliveryParamsDto,
  ): Promise<WebhookDeliveryResponseDto> {
    return this.webhooksService.retryDelivery(apiKey.userId, params.deliveryId);
  }

  // Dashboard routes (JwtAuthGuard, unversioned). Reads skip usage logging,
  // matching the other dashboard list routes; writes log under 'webhooks'.

  @Get('webhooks/endpoints')
  @UseGuards(JwtAuthGuard)
  listEndpointsForUser(
    @CurrentUser() user: User,
  ): Promise<WebhookEndpointResponseDto[]> {
    return this.webhooksService.listEndpoints(user.id);
  }

  @Post('webhooks/endpoints')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @Service('webhooks')
  @UseInterceptors(UsageLoggingInterceptor)
  createEndpointForUser(
    @CurrentUser() user: User,
    @Body() dto: CreateWebhookEndpointDto,
  ): Promise<WebhookEndpointWithSecretResponseDto> {
    return this.webhooksService.createEndpoint(user.id, dto);
  }

  @Patch('webhooks/endpoints/:endpointId')
  @UseGuards(JwtAuthGuard)
  @Service('webhooks')
  @UseInterceptors(UsageLoggingInterceptor)
  updateEndpointForUser(
    @CurrentUser() user: User,
    @Param() params: WebhookEndpointParamsDto,
    @Body() dto: UpdateWebhookEndpointDto,
  ): Promise<WebhookEndpointResponseDto> {
    return this.webhooksService.updateEndpoint(user.id, params.endpointId, dto);
  }

  @Delete('webhooks/endpoints/:endpointId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @Service('webhooks')
  @UseInterceptors(UsageLoggingInterceptor)
  deleteEndpointForUser(
    @CurrentUser() user: User,
    @Param() params: WebhookEndpointParamsDto,
  ): Promise<void> {
    return this.webhooksService.deleteEndpoint(user.id, params.endpointId);
  }

  @Post('webhooks/endpoints/:endpointId/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Service('webhooks')
  @UseInterceptors(UsageLoggingInterceptor)
  rotateSecretForUser(
    @CurrentUser() user: User,
    @Param() params: WebhookEndpointParamsDto,
  ): Promise<WebhookEndpointWithSecretResponseDto> {
    return this.webhooksService.rotateSecret(user.id, params.endpointId);
  }

  @Post('webhooks/endpoints/:endpointId/test')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  @Service('webhooks')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  sendTestEventForUser(
    @CurrentUser() user: User,
    @Param() params: WebhookEndpointParamsDto,
  ): Promise<WebhookDeliveryResponseDto> {
    return this.webhooksService.sendTestEvent(user.id, params.endpointId);
  }

  @Get('webhooks/deliveries')
  @UseGuards(JwtAuthGuard)
  listDeliveriesForUser(
    @CurrentUser() user: User,
    @Query() query: WebhookDeliveryQueryDto,
  ): Promise<WebhookDeliveryListResponseDto> {
    return this.webhooksService.listDeliveries(user.id, query);
  }

  @Post('webhooks/deliveries/:deliveryId/retry')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @Service('webhooks')
  @UseInterceptors(UsageLoggingInterceptor)
  retryDeliveryForUser(
    @CurrentUser() user: User,
    @Param() params: WebhookDeliveryParamsDto,
  ): Promise<WebhookDeliveryResponseDto> {
    return this.webhooksService.retryDelivery(user.id, params.deliveryId);
  }
}
