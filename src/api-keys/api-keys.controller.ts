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
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiKeyService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ApiKeyResponseDto } from './dto/api-key-response.dto';
import { CreatedApiKeyResponseDto } from './dto/created-api-key-response.dto';
import { RevokeApiKeyParamsDto } from './dto/revoke-api-key-params.dto';
import type { User } from '../../generated/prisma';

@Controller('api-keys')
@UseGuards(JwtAuthGuard)
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Post()
  create(
    @CurrentUser() user: User,
    @Body() dto: CreateApiKeyDto,
  ): Promise<CreatedApiKeyResponseDto> {
    return this.apiKeyService.create(user.id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: User): Promise<ApiKeyResponseDto[]> {
    return this.apiKeyService.findAllForUser(user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @CurrentUser() user: User,
    @Param() params: RevokeApiKeyParamsDto,
  ): Promise<void> {
    return this.apiKeyService.revoke(user.id, params.id);
  }
}
