import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import {
  IS_PUBLIC,
  REQUIRED_PERMISSIONS,
  REQUIRED_REALM,
} from '../src/common/decorators/auth.decorators';
import { PERMISSION_KEYS } from '../src/rbac/permissions.catalog';

/**
 * Enforces deny-by-default across the whole API surface.
 *
 * Every route must either be explicitly @Public or declare @RequirePermissions.
 * A route that declares neither is refused at runtime by PermissionsGuard, but
 * that only shows up when someone calls it — this test fails the build instead,
 * the moment the route is added.
 *
 * It walks the real router, so it covers every controller automatically and
 * cannot drift the way a hand-maintained list would.
 */
describe('route authorization coverage', () => {
  let app: INestApplication;
  let routes: Array<{
    method: string;
    path: string;
    isPublic: boolean;
    permissions: string[] | undefined;
    realm: string | undefined;
  }>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const reflector = app.get(Reflector);
    const server = app.getHttpAdapter().getInstance() as {
      router?: { stack: unknown[] };
      _router?: { stack: unknown[] };
    };
    const stack = (server.router ?? server._router)?.stack ?? [];

    routes = [];
    for (const layer of stack as Array<Record<string, any>>) {
      const route = layer.route;
      if (!route) continue;

      const handler = route.stack?.[0]?.handle;
      if (!handler) continue;

      for (const [method, enabled] of Object.entries(route.methods as Record<string, boolean>)) {
        if (!enabled) continue;
        routes.push({
          method: method.toUpperCase(),
          path: route.path,
          isPublic: reflector.get<boolean>(IS_PUBLIC, handler) === true,
          permissions: reflector.get<string[]>(REQUIRED_PERMISSIONS, handler),
          realm: reflector.get<string>(REQUIRED_REALM, handler),
        });
      }
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('discovers routes to check', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it('declares either @Public or @RequirePermissions on every route', () => {
    const undeclared = routes
      .filter((r) => !r.isPublic && (!r.permissions || r.permissions.length === 0))
      .map((r) => `${r.method} ${r.path}`);

    expect(
      undeclared,
      `These routes declare no permission and are not @Public:\n  ${undeclared.join('\n  ')}`,
    ).toEqual([]);
  });

  it('references only permissions that exist in the catalog', () => {
    const unknown: string[] = [];
    for (const route of routes) {
      for (const key of route.permissions ?? []) {
        if (!PERMISSION_KEYS.has(key)) unknown.push(`${route.method} ${route.path} -> "${key}"`);
      }
    }
    expect(unknown, `Routes referencing unknown permissions:\n  ${unknown.join('\n  ')}`).toEqual([]);
  });

  it('keeps the two sign-in endpoints separate and public', () => {
    // Matched by suffix: the global prefix is applied during bootstrap, not by
    // the testing module, so asserting the full path would test configuration
    // rather than routing.
    const paths = routes.map((r) => r.path);
    const has = (suffix: string) => paths.some((p) => p.endsWith(suffix));

    expect(has('/auth/customer/login'), 'customer login route is missing').toBe(true);
    expect(has('/auth/admin/login'), 'admin login route is missing').toBe(true);

    for (const login of routes.filter((r) => r.path.endsWith('/login'))) {
      expect(login.isPublic, `${login.path} must be public`).toBe(true);
    }
  });
});
