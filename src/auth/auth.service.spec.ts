import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { user: { upsert: jest.Mock } };
  let jwtService: { signAsync: jest.Mock };

  beforeEach(async () => {
    prisma = { user: { upsert: jest.fn() } };
    jwtService = { signAsync: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('findOrCreateUser', () => {
    it('upserts a local User keyed by email', async () => {
      const user = { id: 'google-sub-1', email: 'user@example.com' };
      prisma.user.upsert.mockResolvedValue(user);

      const result = await service.findOrCreateUser({
        sub: 'google-sub-1',
        email: 'user@example.com',
      });

      expect(result).toEqual(user);
      expect(prisma.user.upsert).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
        update: {},
        create: { id: 'google-sub-1', email: 'user@example.com' },
      });
    });
  });

  describe('signToken', () => {
    it('signs a JWT encoding the user id and email', async () => {
      jwtService.signAsync.mockResolvedValue('signed.jwt.token');

      const result = await service.signToken({
        id: 'google-sub-1',
        email: 'user@example.com',
        createdAt: new Date('2026-08-30T00:00:00Z'),
      });

      expect(result).toBe('signed.jwt.token');
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: 'google-sub-1',
        email: 'user@example.com',
      });
    });
  });
});
