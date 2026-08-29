import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { jwtVerify } from 'jose';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => 'mock-jwks'),
  jwtVerify: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { user: { upsert: jest.Mock } };
  const mockJwtVerify = jwtVerify as jest.Mock;

  beforeEach(async () => {
    prisma = { user: { upsert: jest.fn() } };
    mockJwtVerify.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: ConfigService,
          useValue: { get: () => 'https://project.supabase.co' },
        },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('returns the synced local user for a valid token', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { sub: 'user-1', email: 'user@example.com' },
    });
    prisma.user.upsert.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
    });

    const result = await service.verifyAndSyncUser('valid-token');

    expect(result).toEqual({ id: 'user-1', email: 'user@example.com' });
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      update: {},
      create: { id: 'user-1', email: 'user@example.com' },
    });
  });

  it('throws UnauthorizedException when the token fails verification', async () => {
    mockJwtVerify.mockRejectedValue(new Error('signature verification failed'));

    await expect(service.verifyAndSyncUser('bad-token')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when required claims are missing', async () => {
    mockJwtVerify.mockResolvedValue({ payload: { sub: 'user-1' } });

    await expect(service.verifyAndSyncUser('token-no-email')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });
});
