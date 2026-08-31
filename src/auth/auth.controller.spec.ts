import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { findOrCreateUser: jest.Mock; signToken: jest.Mock };

  beforeEach(async () => {
    authService = { findOrCreateUser: jest.fn(), signToken: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: ConfigService,
          useValue: { get: () => 'http://localhost:3001' },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AuthController);
  });

  describe('googleCallback', () => {
    it('finds-or-creates the user, signs a token, and redirects with it', async () => {
      const user = { id: 'google-sub-1', email: 'user@example.com' };
      authService.findOrCreateUser.mockResolvedValue(user);
      authService.signToken.mockResolvedValue('signed.jwt.token');
      const req = {
        user: { sub: 'google-sub-1', email: 'user@example.com' },
      } as never;
      const redirect = jest.fn();
      const res = { redirect } as unknown as Response;

      await controller.googleCallback(req, res);

      expect(authService.findOrCreateUser).toHaveBeenCalledWith({
        sub: 'google-sub-1',
        email: 'user@example.com',
      });
      expect(authService.signToken).toHaveBeenCalledWith(user);
      expect(redirect).toHaveBeenCalledWith(
        'http://localhost:3001/auth/callback#token=signed.jwt.token',
      );
    });
  });
});
