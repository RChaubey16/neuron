import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let prisma: { user: { findUniqueOrThrow: jest.Mock } };

  const contextFor = (headers: Record<string, string> = {}) => {
    const request: { headers: Record<string, string>; user?: unknown } = {
      headers,
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  beforeEach(async () => {
    jwtService = { verifyAsync: jest.fn() };
    prisma = { user: { findUniqueOrThrow: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: JwtService, useValue: jwtService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    guard = module.get(JwtAuthGuard);
  });

  it('allows the request and attaches the user for a valid bearer token', async () => {
    const { context, request } = contextFor({
      authorization: 'Bearer valid-token',
    });
    const user = { id: 'user-1', email: 'user@example.com' };
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.com',
    });
    prisma.user.findUniqueOrThrow.mockResolvedValue(user);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-token');
    expect(prisma.user.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    });
    expect(request.user).toBe(user);
  });

  it('throws UnauthorizedException when the Authorization header is missing', async () => {
    const { context } = contextFor();

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when the Authorization header is not a Bearer token', async () => {
    const { context } = contextFor({ authorization: 'Basic abc123' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when the token fails verification', async () => {
    const { context } = contextFor({ authorization: 'Bearer bad-token' });
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when the token is valid but the user no longer exists', async () => {
    const { context } = contextFor({ authorization: 'Bearer valid-token' });
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'deleted-user',
      email: 'gone@example.com',
    });
    prisma.user.findUniqueOrThrow.mockRejectedValue(new Error('Not found'));

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
