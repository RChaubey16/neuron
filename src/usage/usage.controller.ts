import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsageService } from './usage.service';
import { UsageSummaryDto } from './dto/usage-summary.dto';
import type { User } from '../../generated/prisma';

@Controller('usage')
@UseGuards(JwtAuthGuard)
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get()
  getSummary(@CurrentUser() user: User): Promise<UsageSummaryDto[]> {
    return this.usageService.getSummaryForUser(user.id);
  }
}
