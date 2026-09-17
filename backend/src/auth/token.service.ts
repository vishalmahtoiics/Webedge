import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Realm } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { loadConfig } from '../config/env';
import { unauthenticated } from '../common/errors';
import type { Principal } from '../common/principal';

type AccessClaims = {
  sub: string;
  realm: Realm;
  cid?: string;
};

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
};

@Injectable()
export class TokenService {
  private readonly config = loadConfig();

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Refresh tokens are random, not JWTs: they carry no claims, so they cannot be
   * read or forged, only looked up. Only the SHA-256 hash is stored, so a
   * database read cannot mint a session.
   */
  private static hashRefreshToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * The access token carries identity only — never permissions. Permissions and
   * account status are read per request, so revoking a role or suspending an
   * account takes effect immediately instead of lingering until the token
   * expires.
   */
  async verifyAccessToken(raw: string): Promise<Principal> {
    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(raw, {
        secret: this.config.JWT_ACCESS_SECRET,
      });
    } catch {
      throw unauthenticated();
    }

    return claims.realm === Realm.ADMIN
      ? this.loadAdminPrincipal(claims.sub)
      : this.loadCustomerPrincipal(claims.sub);
  }

  private async loadAdminPrincipal(userId: string): Promise<Principal> {
    const user = await this.prisma.adminUser.findUnique({
      where: { id: userId },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!user || user.status !== 'ACTIVE') throw unauthenticated();

    return {
      realm: Realm.ADMIN,
      userId: user.id,
      email: user.email,
      roleId: user.roleId,
      roleName: user.role.name,
      permissions: new Set(user.role.permissions.map((rp) => rp.permission.key)),
    };
  }

  private async loadCustomerPrincipal(userId: string): Promise<Principal> {
    const user = await this.prisma.customerUser.findUnique({
      where: { id: userId },
      include: {
        customer: { select: { status: true } },
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });
    if (!user || user.status !== 'ACTIVE') throw unauthenticated();
    // A suspended tenant locks out its users even if their own row is active.
    if (user.customer.status !== 'ACTIVE') throw unauthenticated();

    return {
      realm: Realm.CUSTOMER,
      userId: user.id,
      customerId: user.customerId,
      email: user.email,
      roleId: user.roleId,
      roleName: user.role.name,
      permissions: new Set(user.role.permissions.map((rp) => rp.permission.key)),
    };
  }

  async issue(
    realm: Realm,
    userId: string,
    customerId: string | undefined,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<IssuedTokens> {
    const claims: AccessClaims = { sub: userId, realm, ...(customerId ? { cid: customerId } : {}) };

    const accessToken = await this.jwt.signAsync(claims, {
      secret: this.config.JWT_ACCESS_SECRET,
      expiresIn: this.config.JWT_ACCESS_TTL,
    });

    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      Date.now() +
        (realm === Realm.ADMIN
          ? this.config.ADMIN_JWT_REFRESH_TTL_HOURS * 60 * 60 * 1000
          : this.config.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
    );

    await this.prisma.refreshToken.create({
      data: {
        tokenHash: TokenService.hashRefreshToken(refreshToken),
        realm,
        adminUserId: realm === Realm.ADMIN ? userId : null,
        customerUserId: realm === Realm.CUSTOMER ? userId : null,
        expiresAt,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      },
    });

    return { accessToken, refreshToken, expiresIn: this.config.JWT_ACCESS_TTL };
  }

  /**
   * Rotates a refresh token.
   *
   * Presenting a token that was already rotated means either a replay or a
   * stolen token being used alongside the legitimate one. Either way the family
   * is compromised, so every token for that user is revoked and they must sign
   * in again — the standard response to refresh-token reuse.
   */
  async rotate(
    rawToken: string,
    context: { ipAddress?: string; userAgent?: string },
  ): Promise<IssuedTokens> {
    const tokenHash = TokenService.hashRefreshToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!existing) throw unauthenticated();

    if (existing.revokedAt) {
      await this.revokeAllForUser(existing.realm, existing.adminUserId ?? existing.customerUserId);
      throw unauthenticated();
    }

    if (existing.expiresAt.getTime() <= Date.now()) throw unauthenticated();

    const userId = existing.adminUserId ?? existing.customerUserId;
    if (!userId) throw unauthenticated();

    let customerId: string | undefined;
    if (existing.realm === Realm.CUSTOMER) {
      const user = await this.prisma.customerUser.findUnique({
        where: { id: userId },
        select: { customerId: true },
      });
      if (!user) throw unauthenticated();
      customerId = user.customerId;
    }

    const issued = await this.issue(existing.realm, userId, customerId, context);

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    return issued;
  }

  async revoke(rawToken: string): Promise<void> {
    const tokenHash = TokenService.hashRefreshToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(realm: Realm, userId: string | null): Promise<void> {
    if (!userId) return;
    await this.prisma.refreshToken.updateMany({
      where: {
        revokedAt: null,
        ...(realm === Realm.ADMIN ? { adminUserId: userId } : { customerUserId: userId }),
      },
      data: { revokedAt: new Date() },
    });
  }
}
