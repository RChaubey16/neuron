import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { nanoid } from 'nanoid';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShortUrlDto } from './dto/create-short-url.dto';
import { ShortUrlResponseDto } from './dto/short-url-response.dto';
import { ShortUrlListResponseDto } from './dto/short-url-list-response.dto';

export const CODE_LENGTH = 7;
const MAX_CREATE_ATTEMPTS = 5;

@Injectable()
export class ShortUrlService {
  private readonly logger = new Logger(ShortUrlService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a shortened URL owned by the given user, retrying with a fresh
   * code on the rare unique-constraint collision.
   * Throws a ConflictException if no unique code could be generated after
   * several attempts.
   *
   * @param owner - Id of the owning user, plus the ApiKey id when a machine
   *   made the request (omitted for a dashboard-native call)
   * @param dto - Validated payload containing the URL to shorten
   * @returns The created short URL's metadata
   */
  async create(
    owner: { userId: string; apiKeyId?: string },
    dto: CreateShortUrlDto,
  ): Promise<ShortUrlResponseDto> {
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
      const code = nanoid(CODE_LENGTH);
      try {
        const shortUrl = await this.prisma.shortUrl.create({
          data: {
            code,
            originalUrl: dto.originalUrl,
            userId: owner.userId,
            apiKeyId: owner.apiKeyId,
          },
        });
        return new ShortUrlResponseDto(shortUrl);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException(
      'Could not generate a unique short code, please try again',
    );
  }

  /**
   * Lists short URLs owned by the given user, most recently created first,
   * for the dashboard's URL listing page. Spans every URL the user owns
   * regardless of whether it was created via a real API key or directly
   * from the dashboard.
   *
   * @param userId - Id of the dashboard user
   * @param limit - Max number of rows to return
   * @param offset - Number of rows to skip, for pagination
   * @returns A page of the user's short URLs plus the total matching count
   */
  async findAllForUser(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<ShortUrlListResponseDto> {
    return this.listByWhere({ userId }, limit, offset);
  }

  /**
   * Lists short URLs created by the given API key itself, most recently
   * created first, for the machine-facing `GET /api/v1/short-url` route.
   * Scoped to just the calling key — unlike the dashboard's
   * `findAllForUser`, which spans every key a human owns — since an API key
   * is meant to be a narrowly-scoped machine credential, not full account
   * access.
   *
   * @param apiKeyId - Id of the ApiKey making the request
   * @param limit - Max number of rows to return
   * @param offset - Number of rows to skip, for pagination
   * @returns A page of the key's short URLs plus the total matching count
   */
  async findAllForApiKey(
    apiKeyId: string,
    limit: number,
    offset: number,
  ): Promise<ShortUrlListResponseDto> {
    return this.listByWhere({ apiKeyId }, limit, offset);
  }

  /**
   * Shared pagination/query logic behind `findAllForUser` and
   * `findAllForApiKey`, which differ only in how results are scoped.
   *
   * @param where - Prisma filter scoping results to the caller
   * @param limit - Max number of rows to return
   * @param offset - Number of rows to skip, for pagination
   * @returns A page of matching short URLs plus the total matching count
   */
  private async listByWhere(
    where: Prisma.ShortUrlWhereInput,
    limit: number,
    offset: number,
  ): Promise<ShortUrlListResponseDto> {
    const [shortUrls, total] = await Promise.all([
      this.prisma.shortUrl.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.shortUrl.count({ where }),
    ]);

    return new ShortUrlListResponseDto({
      items: shortUrls.map((shortUrl) => new ShortUrlResponseDto(shortUrl)),
      total,
      limit,
      offset,
    });
  }

  /**
   * Resolves a short code to its original URL for the public redirect route.
   * Throws a NotFoundException if the code doesn't exist.
   *
   * @param code - The short code from the request path
   * @returns The original URL to redirect to
   */
  async resolve(code: string): Promise<string> {
    const shortUrl = await this.prisma.shortUrl.findUnique({
      where: { code },
    });
    if (!shortUrl) {
      throw new NotFoundException('Short URL not found');
    }

    // Fire-and-forget: a slow/failed click-count update shouldn't delay or
    // break the redirect. `.catch()` subscribes (triggering the lazy
    // PrismaPromise's execution) without blocking — a bare `void` would
    // silently drop the query.
    this.prisma.shortUrl
      .update({
        where: { code },
        data: { clickCount: { increment: 1 } },
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Failed to increment clickCount for short code ${code}`,
          error instanceof Error ? error.stack : error,
        );
      });

    return shortUrl.originalUrl;
  }
}
