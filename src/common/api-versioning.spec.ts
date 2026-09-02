import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AppController } from '../app.controller';
import { AuthController } from '../auth/auth.controller';
import { ApiKeyController } from '../api-keys/api-keys.controller';
import { ApiKeyGuard } from '../api-keys/guards/api-key.guard';
import { HealthController } from '../health/health.controller';
import { UsageController } from '../usage/usage.controller';
import { ShortUrlController } from '../short-url/short-url.controller';

/**
 * Regression test for the API versioning convention (see the Architecture
 * section of CLAUDE.md): every route protected by ApiKeyGuard — the
 * machine-to-machine "service" credential — must live under
 * `/api/v{n}/...`; every other route (dashboard routes behind JwtAuthGuard,
 * the OAuth handshake, health checks, the public short-url redirect) must
 * not. This inspects route/guard metadata directly via `Reflect` rather
 * than booting the app, so it stays fast and never needs DB/JWT mocks —
 * and it fails automatically the moment a future service module (e.g.
 * notifications) adds an ApiKeyGuard route without the version prefix, or
 * a dashboard route accidentally gets one.
 */

const ALL_CONTROLLERS = [
  AppController,
  HealthController,
  AuthController,
  ApiKeyController,
  UsageController,
  ShortUrlController,
];

interface RouteInfo {
  controller: string;
  path: string;
  isApiKeyGuarded: boolean;
}

function normalizePath(...segments: string[]): string {
  const joined = `/${segments.filter(Boolean).join('/')}`;
  return joined.replace(/\/+/g, '/');
}

function collectRoutes(
  controllers: (new (...args: never[]) => object)[],
): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const controller of controllers) {
    const basePath =
      (Reflect.getMetadata(PATH_METADATA, controller) as string) ?? '';
    const classGuards =
      (Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]) ?? [];
    const prototype = controller.prototype as Record<string, unknown>;

    for (const propertyName of Object.getOwnPropertyNames(prototype)) {
      if (propertyName === 'constructor') {
        continue;
      }
      const handler = prototype[propertyName];
      const methodPath = Reflect.getMetadata(PATH_METADATA, handler) as
        string | undefined;
      if (typeof handler !== 'function' || methodPath === undefined) {
        continue; // not a route handler
      }

      const methodGuards =
        (Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? [];
      const isApiKeyGuarded = [...classGuards, ...methodGuards].includes(
        ApiKeyGuard,
      );

      routes.push({
        controller: controller.name,
        path: normalizePath(basePath, methodPath),
        isApiKeyGuarded,
      });
    }
  }

  return routes;
}

describe('API versioning convention', () => {
  const routes = collectRoutes(ALL_CONTROLLERS);

  it('sanity-checks that route metadata was actually found', () => {
    // Guards against this test silently passing with 0 assertions if
    // reflection ever stops finding routes (e.g. a Nest metadata key rename).
    expect(routes.length).toBeGreaterThanOrEqual(10);
  });

  it('versions every ApiKeyGuard-protected route under /api/v{n}/...', () => {
    const serviceRoutes = routes.filter((route) => route.isApiKeyGuarded);
    expect(serviceRoutes.length).toBeGreaterThan(0);

    for (const route of serviceRoutes) {
      expect(route.path).toMatch(/^\/api\/v\d+\//);
    }
  });

  it('never applies a version prefix to a non-ApiKeyGuard route', () => {
    const nonServiceRoutes = routes.filter((route) => !route.isApiKeyGuarded);
    expect(nonServiceRoutes.length).toBeGreaterThan(0);

    for (const route of nonServiceRoutes) {
      expect(route.path).not.toMatch(/^\/api\/v\d+\//);
    }
  });
});
