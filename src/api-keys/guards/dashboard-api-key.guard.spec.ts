import { ExecutionContext } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DashboardApiKeyGuard } from './dashboard-api-key.guard';
import { ApiKeyService } from '../api-keys.service';

describe('DashboardApiKeyGuard', () => {
  let guard: DashboardApiKeyGuard;
  let apiKeyService: { getOrCreateSystemKey: jest.Mock };

  const contextFor = (user: { id: string }) => {
    const request: { user: { id: string }; apiKey?: unknown } = { user };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  beforeEach(async () => {
    apiKeyService = { getOrCreateSystemKey: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardApiKeyGuard,
        { provide: ApiKeyService, useValue: apiKeyService },
      ],
    }).compile();

    guard = module.get(DashboardApiKeyGuard);
  });

  it("resolves the caller's system key and attaches it to the request", async () => {
    const systemKey = {
      id: 'system-key-1',
      userId: 'user-1',
      isSystemKey: true,
    };
    apiKeyService.getOrCreateSystemKey.mockResolvedValue(systemKey);
    const { context, request } = contextFor({ id: 'user-1' });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(apiKeyService.getOrCreateSystemKey).toHaveBeenCalledWith('user-1');
    expect(request.apiKey).toBe(systemKey);
  });
});
