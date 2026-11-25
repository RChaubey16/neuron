import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';
import { EmailsController } from './emails.controller.js';
import { EmailsService } from './emails.service.js';

@Module({
  imports: [ApiKeysModule],
  controllers: [EmailsController],
  providers: [EmailsService],
})
export class EmailsModule {}
