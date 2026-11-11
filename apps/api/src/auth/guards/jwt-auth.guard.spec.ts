import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type {
  AuthenticatedRequest,
  AuthUser,
} from '@/common/interfaces/auth-user.interface.js';
import { AuthErrorMessage } from '../auth.constants.js';
import type { AuthService } from '../auth.service.js';
import { extractBearerToken, JwtAuthGuard } from './jwt-auth.guard.js';

const USER: AuthUser = {
  id: '6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60',
  email: 'user@example.com',
  fullName: null,
  avatarUrl: null,
};

function contextFor(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('extractBearerToken', () => {
  it.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer abc', 'abc'],
    ['Bearer   abc  ', 'abc'],
  ])('reads %j', (header, token) => {
    expect(extractBearerToken(header)).toBe(token);
  });

  it.each([
    undefined,
    '',
    'Bearer',
    'Bearer ',
    'Basic abc',
    'Bearer a b',
    'abc',
  ])('returns undefined for %j', (header) => {
    expect(extractBearerToken(header)).toBeUndefined();
  });
});

describe('JwtAuthGuard', () => {
  let reflector: Reflector;
  let verifyAccessToken: ReturnType<typeof vi.fn>;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    verifyAccessToken = vi.fn().mockResolvedValue(USER);
    guard = new JwtAuthGuard(reflector, {
      verifyAccessToken,
    } as unknown as AuthService);
  });

  it('allows @Public() routes without a token', async () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    await expect(guard.canActivate(contextFor({ headers: {} }))).resolves.toBe(
      true,
    );
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a request without a bearer token', async () => {
    const error: unknown = await guard
      .canActivate(contextFor({ headers: { authorization: 'Basic abc' } }))
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as Error).message).toBe(AuthErrorMessage.Missing);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('verifies the token and sets request.user', async () => {
    const request: Partial<AuthenticatedRequest> = {
      headers: { authorization: 'Bearer token-123' },
    };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(verifyAccessToken).toHaveBeenCalledWith('token-123');
    expect(request.user).toEqual(USER);
  });

  it('propagates verification errors', async () => {
    verifyAccessToken.mockRejectedValue(
      new UnauthorizedException(AuthErrorMessage.Expired),
    );
    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: 'Bearer token-123' } }),
      ),
    ).rejects.toThrow(AuthErrorMessage.Expired);
  });
});
