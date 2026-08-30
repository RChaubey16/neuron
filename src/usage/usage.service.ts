import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { UsageSummaryDto } from './dto/usage-summary.dto';

interface UsageSummaryRow {
  service: string;
  date: Date;
  apiKeyId: string;
  count: bigint;
}

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns call counts grouped by service, day, and key, scoped to API
   * keys owned by the given user.
   *
   * @param userId - Id of the caller, to scope the aggregate to their own keys
   * @returns Usage rows ordered most-recent day first
   */
  async getSummaryForUser(userId: string): Promise<UsageSummaryDto[]> {
    // Raw SQL because Prisma's groupBy can't date-truncate createdAt down
    // to a calendar day across a related table's foreign key filter.
    const rows = await this.prisma.$queryRaw<UsageSummaryRow[]>(Prisma.sql`
      SELECT "service", DATE_TRUNC('day', "createdAt") AS "date", "apiKeyId", COUNT(*) AS "count"
      FROM "UsageLog"
      WHERE "apiKeyId" IN (SELECT "id" FROM "ApiKey" WHERE "userId" = ${userId})
      GROUP BY "service", "date", "apiKeyId"
      ORDER BY "date" DESC
    `);

    return rows.map(
      (row) =>
        new UsageSummaryDto({
          service: row.service,
          date: row.date.toISOString().slice(0, 10),
          apiKeyId: row.apiKeyId,
          count: Number(row.count),
        }),
    );
  }
}
