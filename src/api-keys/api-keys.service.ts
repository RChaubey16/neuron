import { randomBytes, createHash } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ApiKeyResponseDto } from './dto/api-key-response.dto';
import { CreatedApiKeyResponseDto } from './dto/created-api-key-response.dto';

const KEY_PREFIX = 'nrn_';
const KEY_PREFIX_DISPLAY_LENGTH = 12;

@Injectable()
export class ApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generates a new API key for the given user, storing only its SHA-256
   * hash and a short display prefix.
   *
   * @param userId - Id of the owning `User`
   * @param dto - Optional display name for the key
   * @returns The created key's metadata plus the raw key, shown this once
   */
  async create(
    userId: string,
    dto: CreateApiKeyDto,
  ): Promise<CreatedApiKeyResponseDto> {
    const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    const keyPrefix = key.slice(0, KEY_PREFIX_DISPLAY_LENGTH);
    // Raw key is high-entropy (32 random bytes), so an unsalted SHA-256
    // digest can't be brute-forced from a leaked DB — no pepper needed.
    const hashedKey = createHash('sha256').update(key).digest('hex');

    const apiKey = await this.prisma.apiKey.create({
      data: { userId, hashedKey, keyPrefix, name: dto.name },
    });

    return new CreatedApiKeyResponseDto({
      id: apiKey.id,
      keyPrefix: apiKey.keyPrefix,
      name: apiKey.name,
      createdAt: apiKey.createdAt,
      lastUsedAt: apiKey.lastUsedAt,
      revokedAt: apiKey.revokedAt,
      key,
    });
  }

  /**
   * Lists all API keys belonging to a user, most recently created first.
   *
   * @param userId - Id of the owning `User`
   * @returns The user's keys, never including the raw key or its hash
   */
  async findAllForUser(userId: string): Promise<ApiKeyResponseDto[]> {
    const apiKeys = await this.prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return apiKeys.map((apiKey) => new ApiKeyResponseDto(apiKey));
  }

  /**
   * Revokes (soft-deletes) one of the caller's own API keys.
   * Throws a NotFoundException if the key doesn't exist, isn't owned by the
   * caller, or is already revoked.
   *
   * @param userId - Id of the caller, to scope the lookup to their own keys
   * @param id - Id of the `ApiKey` to revoke
   */
  async revoke(userId: string, id: string): Promise<void> {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { id, userId, revokedAt: null },
    });
    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }
}
