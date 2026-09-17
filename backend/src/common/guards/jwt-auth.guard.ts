import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../principal';
import { IS_PUBLIC } from '../decorators/auth.decorators';
import { TokenService } from '../../auth/token.service';
import { unauthenticated } from '../errors';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers['authorization'];
    const raw = typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice('Bearer '.length)
      : undefined;

    if (!raw) throw unauthenticated();

    req.principal = await this.tokens.verifyAccessToken(raw);
    return true;
  }
}
