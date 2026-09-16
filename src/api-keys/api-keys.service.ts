import { randomBytes, createHash } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { ApiKeyResponseDto } from './dto/api-key-response.dto';
import { CreatedApiKeyResponseDto } from './dto/created-api-key-response.dto';
import { Prisma, ApiKey } from '../../generated/prisma';

const KEY_PREFIX = 'nrn_';
const KEY_PREFIX_DISPLAY_LENGTH = 12;
const SYSTEM_KEY_NAME = 'Dashboard';

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
      where: { userId, isSystemKey: false },
      orderBy: { createdAt: 'desc' },
    });

    return apiKeys.map((apiKey) => new ApiKeyResponseDto(apiKey));
  }

  /**
   * Revokes (soft-deletes) one of the caller's own API keys.
   * Throws a NotFoundException if the key doesn't exist, isn't owned by the
   * caller, is already revoked, or is the hidden dashboard system key (see
   * `getOrCreateSystemKey`) — that key can never be revoked through the API.
   *
   * @param userId - Id of the caller, to scope the lookup to their own keys
   * @param id - Id of the `ApiKey` to revoke
   */
  async revoke(userId: string, id: string): Promise<void> {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { id, userId, isSystemKey: false, revokedAt: null },
    });
    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Resolves the hidden "system" API key representing actions a user takes
   * directly from the dashboard (as opposed to via a machine-held key),
   * lazily creating one on first use. This bridges `JwtAuthGuard`'s
   * human/session auth to service methods that are all scoped by
   * `apiKeyId`, so dashboard-originated calls flow through the exact same
   * code path (`@CurrentApiKey()`, `UsageLoggingInterceptor`) as a real
   * machine-held key with zero changes to either.
   *
   * @param userId - Id of the dashboard user
   * @returns The user's system `ApiKey` row (never containing a usable raw
   *   key — the generated key material only exists to satisfy the
   *   `hashedKey`/`keyPrefix` columns and is discarded immediately)
   */
  async getOrCreateSystemKey(userId: string): Promise<ApiKey> {
    const existing = await this.prisma.apiKey.findFirst({
      where: { userId, isSystemKey: true },
    });
    if (existing) {
      return existing;
    }

    const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    const keyPrefix = key.slice(0, KEY_PREFIX_DISPLAY_LENGTH);
    const hashedKey = createHash('sha256').update(key).digest('hex');

    try {
      return await this.prisma.apiKey.create({
        data: {
          userId,
          hashedKey,
          keyPrefix,
          name: SYSTEM_KEY_NAME,
          isSystemKey: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Lost a concurrent race against another request creating this same
        // user's system key (guarded by the partial unique index on
        // `(userId) WHERE isSystemKey = true`) — return what the winner
        // created instead of throwing.
        const winner = await this.prisma.apiKey.findFirst({
          where: { userId, isSystemKey: true },
        });
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }
}
