import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Redirect,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiKeyGuard } from '../api-keys/guards/api-key.guard';
import { CurrentApiKey } from '../api-keys/decorators/current-api-key.decorator';
import { Service } from '../usage/decorators/service.decorator';
import { UsageLoggingInterceptor } from '../usage/interceptors/usage-logging.interceptor';
import { ShortUrlService } from './short-url.service';
import { CreateShortUrlDto } from './dto/create-short-url.dto';
import { ShortUrlResponseDto } from './dto/short-url-response.dto';
import type { ApiKey } from '../../generated/prisma';

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
    return this.shortUrlService.create(apiKey.id, dto);
  }

  // Unauthenticated by design — meant to be hit directly by browsers.
  // Must stay the last route registered app-wide: NestJS/Express match
  // routes in registration order, and this single-segment param route would
  // otherwise shadow any other top-level GET route (see ShortUrlModule
  // being the last import in AppModule).
  @Get(':code')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Redirect()
  async redirect(@Param('code') code: string): Promise<{ url: string }> {
    const url = await this.shortUrlService.resolve(code);
    return { url };
  }
}
