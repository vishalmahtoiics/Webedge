import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Realm } from '@prisma/client';
import type { AuthenticatedRequest, Principal } from '../principal';

export const IS_PUBLIC = 'webedge:public';
export const REQUIRED_PERMISSIONS = 'webedge:permissions';
export const REQUIRED_REALM = 'webedge:realm';

/**
 * Marks a route as reachable without a session. Every route that is not Public
 * must declare permissions — PermissionsGuard denies anything that declares
 * neither, so a forgotten decorator fails closed.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

export const RequirePermissions = (
  ...permissions: string[]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Restricts a route to one identity realm. */
export const RequireRealm = (realm: Realm): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_REALM, realm);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal | undefined =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().principal,
);
