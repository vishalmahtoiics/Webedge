import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Realm } from '@prisma/client';
import type { AuthenticatedRequest } from '../principal';
import {
  IS_PUBLIC,
  REQUIRED_PERMISSIONS,
  REQUIRED_REALM,
} from '../decorators/auth.decorators';
import { permissionDenied, unauthenticated } from '../errors';

/**
 * Deny by default.
 *
 * A route that is neither @Public nor decorated with @RequirePermissions is
 * refused outright rather than allowed through. Forgetting the decorator then
 * produces a visibly broken route in development instead of an open one in
 * production.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = req.principal;
    if (!principal) throw unauthenticated();

    const requiredRealm = this.reflector.getAllAndOverride<Realm | undefined>(
      REQUIRED_REALM,
      targets,
    );
    if (requiredRealm && principal.realm !== requiredRealm) {
      // A customer session reaching a staff route is a 404, not a 403: a 403
      // would confirm the route exists.
      throw permissionDenied();
    }

    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      REQUIRED_PERMISSIONS,
      targets,
    );
    if (!required || required.length === 0) throw permissionDenied();

    const missing = required.filter((key) => !principal.permissions.has(key));
    if (missing.length > 0) throw permissionDenied();

    return true;
  }
}
