import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

const jwtModule = JwtModule.registerAsync({
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => ({
    secret: configService.getOrThrow<string>('JWT_SECRET'),
    signOptions: {
      // `expiresIn` is only known to be a `string` at this point (an env var
      // read at runtime), but @types/jsonwebtoken's `StringValue` is a
      // template-literal type ("7d", "1h", ...) that can't be proven
      // statically from an arbitrary string.
      expiresIn: (configService.get<string>('JWT_EXPIRES_IN') ?? '7d') as never,
    },
  }),
});

@Module({
  imports: [PassportModule, jwtModule],
  controllers: [AuthController],
  providers: [AuthService, GoogleStrategy, JwtAuthGuard],
  // JwtModule is re-exported (not just imported) so JwtAuthGuard's own
  // JwtService dependency resolves in consuming modules too (ApiKeyModule,
  // UsageModule) — JwtService isn't global like ConfigService/PrismaService,
  // so without this, `imports: [AuthModule]` alone leaves JwtAuthGuard
  // unable to resolve JwtService outside AuthModule's own scope.
  exports: [AuthService, JwtAuthGuard, jwtModule],
})
export class AuthModule {}
