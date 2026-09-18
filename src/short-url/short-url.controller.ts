import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Redirect,
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
import { ShortUrlService } from './short-url.service';
import { CreateShortUrlDto } from './dto/create-short-url.dto';
import { ShortUrlResponseDto } from './dto/short-url-response.dto';
import { ShortUrlListResponseDto } from './dto/short-url-list-response.dto';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { ShortUrlCodeParamsDto } from './dto/short-url-code-params.dto';
import type { ApiKey, User } from '../../generated/prisma';

@Controller()
export class ShortUrlController {
  constructor(private readonly shortUrlService: ShortUrlService) {}

  @Post('api/v1/short-url/shorten')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ApiKeyGuard)
  @Service('url-shortener')
  @UseInterceptors(UsageLoggingInterceptor)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(
    @CurrentApiKey() apiKey: ApiKey,
    @Body() dto: CreateShortUrlDto,
  ): Promise<ShortUrlResponseDto> {
    return this.shortUrlService.create(
      { userId: apiKey.userId, apiKeyId: apiKey.id },
      dto,
    );
  }

  @Get('api/v1/short-url')
  @UseGuards(ApiKeyGuard)
  @Service('url-shortener')
  @UseInterceptors(UsageLoggingInterceptor)
  findAllForApiKey(
    @CurrentApiKey() apiKey: ApiKey,
    @Query() query: PaginationQueryDto,
  ): Promise<ShortUrlListResponseDto> {
    return this.shortUrlService.findAllForApiKey(
      apiKey.id,
      query.limit,
      query.offset,
    );
  }

  // Dashboard routes (JwtAuthGuard, unversioned) — must stay declared before
  // the GET ':code' catch-all below, or that single-segment param route
  // would swallow them as `code = "short-url"` (see that handler's comment).
  @Get('short-url')
  @UseGuards(JwtAuthGuard)
  findAllForUser(
    @CurrentUser() user: User,
    @Query() query: PaginationQueryDto,
  ): Promise<ShortUrlListResponseDto> {
    return this.shortUrlService.findAllForUser(
      user.id,
      query.limit,
      query.offset,
    );
  }

  // Dashboard-native counterpart to POST /api/v1/short-url/shorten: calls
  // the same service method directly with the logged-in user's id, no
  // second guard or fabricated ApiKey involved (see
  // docs/2026-09-17-direct-ownership-design.md).
  @Post('short-url')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  @Service('url-shortener')
  @UseInterceptors(UsageLoggingInterceptor)
  createFromDashboard(
    @CurrentUser() user: User,
    @Body() dto: CreateShortUrlDto,
  ): Promise<ShortUrlResponseDto> {
    return this.shortUrlService.create({ userId: user.id }, dto);
  }

  // Unauthenticated by design — meant to be hit directly by browsers.
  // Must stay the last route registered app-wide: NestJS/Express match
  // routes in registration order, and this single-segment param route would
  // otherwise shadow any other top-level GET route (see ShortUrlModule
  // being the last import in AppModule).
  @Get(':code')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Redirect()
  async redirect(
    @Param() params: ShortUrlCodeParamsDto,
  ): Promise<{ url: string }> {
    const url = await this.shortUrlService.resolve(params.code);
    return { url };
  }
}
