import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ApiKeyModule } from './api-keys/api-keys.module';
import { AuthModule } from './auth/auth.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ApiKeyThrottlerGuard } from './common/guards/api-key-throttler.guard';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsageModule } from './usage/usage.module';
import { ShortUrlModule } from './short-url/short-url.module';
import { validate } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 20 }],
    }),
    PrismaModule,
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.getOrThrow<string>('REDIS_HOST'),
          port: configService.getOrThrow<number>('REDIS_PORT'),
        },
      }),
      inject: [ConfigService],
    }),
    HealthModule,
    AuthModule,
    ApiKeyModule,
    UsageModule,
    NotificationsModule,
    // Must stay last: ShortUrlController's GET /:code is a catch-all
    // single-segment route, and Nest/Express match routes in registration
    // order rather than by specificity.
    ShortUrlModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ApiKeyThrottlerGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
