import { Controller, Get, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../auth/guards/supabase-jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsageService } from './usage.service';
import { UsageSummaryDto } from './dto/usage-summary.dto';
import type { User } from '../../generated/prisma';

@Controller('usage')
@UseGuards(SupabaseJwtGuard)
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get()
  getSummary(@CurrentUser() user: User): Promise<UsageSummaryDto[]> {
    return this.usageService.getSummaryForUser(user.id);
  }
}
