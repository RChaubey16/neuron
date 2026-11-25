import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ApiKey, User } from '@neuron/db';
import { AuthService } from '../auth/auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { generateApiKey, hashApiKey, isWellFormedApiKey } from './api-key.js';

/** Most active (unrevoked) keys a user can have at once. */
export const MAX_ACTIVE_API_KEYS = 25;

/** lastUsedAt is updated at most this often per key, so busy keys don't write on every request. */
const LAST_USED_RESOLUTION_MS = 60_000;

export interface ApiKeyResponse {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface CreatedApiKeyResponse extends ApiKeyResponse {
  /** The full key. Returned only in the create response. */
  key: string;
}

export interface AuthenticatedKey {
  apiKey: ApiKey;
  user: User;
}

export function toApiKeyResponse(apiKey: ApiKey): ApiKeyResponse {
  return {
    id: apiKey.id,
    name: apiKey.name,
    prefix: apiKey.prefix,
    createdAt: apiKey.createdAt,
    lastUsedAt: apiKey.lastUsedAt,
    revokedAt: apiKey.revokedAt,
  };
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async create(userId: string, name: string): Promise<CreatedApiKeyResponse> {
    const active = await this.prisma.apiKey.count({ where: { userId, revokedAt: null } });
    if (active >= MAX_ACTIVE_API_KEYS) {
      throw new ConflictException(
        `You can have at most ${MAX_ACTIVE_API_KEYS} active API keys. Revoke one first.`,
      );
    }

    const { key, prefix, hash } = generateApiKey();
    const apiKey = await this.prisma.apiKey.create({
      data: { userId, name, prefix, keyHash: hash },
    });
    return { ...toApiKeyResponse(apiKey), key };
  }

  /** All of the user's keys, newest first, including revoked ones. */
  async list(userId: string): Promise<ApiKeyResponse[]> {
    const keys = await this.prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map(toApiKeyResponse);
  }

  /**
   * Revokes one of the user's keys. Revoking an already-revoked key succeeds
   * without changing it. Someone else's key is reported as not found.
   */
  async revoke(userId: string, id: string): Promise<void> {
    const apiKey = await this.prisma.apiKey.findFirst({ where: { id, userId } });
    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }
    if (apiKey.revokedAt) return;

    await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  /**
   * Resolves a raw key from a request to its key and user. Returns null for
   * malformed, unknown or revoked keys, and for users no longer in ALLOWED_EMAILS.
   */
  async authenticate(rawKey: string): Promise<AuthenticatedKey | null> {
    if (!isWellFormedApiKey(rawKey)) return null;

    const found = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(rawKey) },
      include: { user: true },
    });
    if (!found || found.revokedAt || !this.auth.isAllowed(found.user.email)) return null;

    const { user, ...apiKey } = found;
    await this.recordUse(apiKey.id);
    return { apiKey, user };
  }

  private async recordUse(id: string): Promise<void> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - LAST_USED_RESOLUTION_MS);
    await this.prisma.apiKey.updateMany({
      where: { id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: staleBefore } }] },
      data: { lastUsedAt: now },
    });
  }
}
