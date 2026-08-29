import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseJwtGuard } from './supabase-jwt.guard';
import { AuthService } from '../auth.service';

describe('SupabaseJwtGuard', () => {
  let guard: SupabaseJwtGuard;
  let authService: { verifyAndSyncUser: jest.Mock };

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
    authService = { verifyAndSyncUser: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupabaseJwtGuard,
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    guard = module.get(SupabaseJwtGuard);
  });

  it('allows the request and attaches the user for a valid bearer token', async () => {
    const { context, request } = contextFor({
      authorization: 'Bearer valid-token',
    });
    const user = { id: 'user-1', email: 'user@example.com' };
    authService.verifyAndSyncUser.mockResolvedValue(user);

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(authService.verifyAndSyncUser).toHaveBeenCalledWith('valid-token');
    expect(request.user).toBe(user);
  });

  it('throws UnauthorizedException when the Authorization header is missing', async () => {
    const { context } = contextFor();

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(authService.verifyAndSyncUser).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when the Authorization header is not a Bearer token', async () => {
    const { context } = contextFor({ authorization: 'Basic abc123' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(authService.verifyAndSyncUser).not.toHaveBeenCalled();
  });

  it('propagates the UnauthorizedException thrown by AuthService for an invalid token', async () => {
    const { context } = contextFor({ authorization: 'Bearer bad-token' });
    authService.verifyAndSyncUser.mockRejectedValue(
      new UnauthorizedException('Invalid or expired session token'),
    );

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
