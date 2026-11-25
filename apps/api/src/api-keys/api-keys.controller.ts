import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { ApiKey, User } from '@neuron/db';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ApiKeyGuard } from './api-key.guard.js';
import type { ApiKeyResponse, CreatedApiKeyResponse } from './api-keys.service.js';
import { ApiKeysService } from './api-keys.service.js';
import { CreateApiKeyDto } from './create-api-key.dto.js';
import { CurrentApiKey } from './current-api-key.decorator.js';

/** Key management for the signed-in dashboard user. */
@Controller('api-keys')
@UseGuards(SessionGuard)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Post()
  create(@CurrentUser() user: User, @Body() body: CreateApiKeyDto): Promise<CreatedApiKeyResponse> {
    return this.apiKeys.create(user.id, body.name);
  }

  @Get()
  list(@CurrentUser() user: User): Promise<ApiKeyResponse[]> {
    return this.apiKeys.list(user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  revoke(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.apiKeys.revoke(user.id, id);
  }
}

export interface WhoAmIResponse {
  apiKey: { id: string; name: string; prefix: string };
  user: { id: string; email: string };
}

/** Lets a client check which key and account it is authenticating as. */
@Controller('v1/me')
@UseGuards(ApiKeyGuard)
export class WhoAmIController {
  @Get()
  whoAmI(@CurrentApiKey() apiKey: ApiKey, @CurrentUser() user: User): WhoAmIResponse {
    return {
      apiKey: { id: apiKey.id, name: apiKey.name, prefix: apiKey.prefix },
      user: { id: user.id, email: user.email },
    };
  }
}
