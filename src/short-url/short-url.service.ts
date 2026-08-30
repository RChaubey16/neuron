import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { nanoid } from 'nanoid';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShortUrlDto } from './dto/create-short-url.dto';
import { ShortUrlResponseDto } from './dto/short-url-response.dto';

const CODE_LENGTH = 7;
const MAX_CREATE_ATTEMPTS = 5;

@Injectable()
export class ShortUrlService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a shortened URL owned by the given API key, retrying with a
   * fresh code on the rare unique-constraint collision.
   * Throws a ConflictException if no unique code could be generated after
   * several attempts.
   *
   * @param apiKeyId - Id of the ApiKey making the request
   * @param dto - Validated payload containing the URL to shorten
   * @returns The created short URL's metadata
   */
  async create(
    apiKeyId: string,
    dto: CreateShortUrlDto,
  ): Promise<ShortUrlResponseDto> {
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
      const code = nanoid(CODE_LENGTH);
      try {
        const shortUrl = await this.prisma.shortUrl.create({
          data: { code, originalUrl: dto.originalUrl, apiKeyId },
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
      .catch(() => {});

    return shortUrl.originalUrl;
  }
}
