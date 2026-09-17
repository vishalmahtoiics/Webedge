import { Injectable } from '@nestjs/common';
import { AccountStatus, Realm } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { TokenService, type IssuedTokens } from './token.service';
import { AppError, unauthenticated } from '../common/errors';

/**
 * OWASP-recommended Argon2id parameters. Benchmark on production hardware before
 * launch and raise until a hash takes roughly 0.5s there — these are a floor,
 * not a target.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export type LoginContext = {
  ipAddress?: string;
  userAgent?: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly activity: ActivityService,
  ) {}

  static hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  /**
   * Argon2 verification throws on a malformed hash rather than returning false,
   * which would otherwise surface as a 500 instead of a failed login.
   */
  private static async verifyPassword(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /**
   * Every failure path returns the same error, so responses never reveal whether
   * an email exists, whether the password was wrong, or whether the account is
   * locked or suspended.
   */
  private static failLogin(): never {
    throw new AppError('UNAUTHENTICATED', 'Email or password is incorrect.');
  }

  async loginAdmin(email: string, password: string, ctx: LoginContext): Promise<IssuedTokens> {
    const user = await this.prisma.adminUser.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (!user) {
      // Hash anyway, so a missing account does not answer faster than a wrong
      // password and leak account existence through timing.
      await argon2.hash(password, ARGON2_OPTIONS);
      AuthService.failLogin();
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) AuthService.failLogin();
    if (user.status !== AccountStatus.ACTIVE) AuthService.failLogin();

    if (!(await AuthService.verifyPassword(user.passwordHash, password))) {
      await this.registerFailedAdminLogin(user.id, user.failedLoginCount);
      AuthService.failLogin();
    }

    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const issued = await this.tokens.issue(Realm.ADMIN, user.id, undefined, ctx);

    await this.activity.record(
      {
        realm: Realm.ADMIN,
        userId: user.id,
        email: user.email,
        roleId: user.roleId,
        roleName: '',
        permissions: new Set(),
      },
      {
        action: 'auth.admin.signed_in',
        resourceType: 'admin_user',
        resourceId: user.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    );

    return issued;
  }

  async loginCustomer(email: string, password: string, ctx: LoginContext): Promise<IssuedTokens> {
    const user = await this.prisma.customerUser.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { customer: { select: { id: true, status: true } } },
    });

    if (!user) {
      await argon2.hash(password, ARGON2_OPTIONS);
      AuthService.failLogin();
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) AuthService.failLogin();
    if (user.status !== AccountStatus.ACTIVE) AuthService.failLogin();
    if (user.customer.status !== AccountStatus.ACTIVE) AuthService.failLogin();

    if (!(await AuthService.verifyPassword(user.passwordHash, password))) {
      await this.registerFailedCustomerLogin(user.id, user.failedLoginCount);
      AuthService.failLogin();
    }

    await this.prisma.customerUser.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const issued = await this.tokens.issue(Realm.CUSTOMER, user.id, user.customerId, ctx);

    await this.activity.record(
      {
        realm: Realm.CUSTOMER,
        userId: user.id,
        customerId: user.customerId,
        email: user.email,
        roleId: user.roleId,
        roleName: '',
        permissions: new Set(),
      },
      {
        action: 'auth.customer.signed_in',
        customerId: user.customerId,
        resourceType: 'customer_user',
        resourceId: user.id,
        visibility: 'CUSTOMER',
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    );

    return issued;
  }

  private async registerFailedAdminLogin(userId: string, current: number): Promise<void> {
    const next = current + 1;
    await this.prisma.adminUser.update({
      where: { id: userId },
      data: {
        failedLoginCount: next,
        lockedUntil:
          next >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });
  }

  private async registerFailedCustomerLogin(userId: string, current: number): Promise<void> {
    const next = current + 1;
    await this.prisma.customerUser.update({
      where: { id: userId },
      data: {
        failedLoginCount: next,
        lockedUntil:
          next >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });
  }

  refresh(rawToken: string, ctx: LoginContext): Promise<IssuedTokens> {
    if (!rawToken) throw unauthenticated();
    return this.tokens.rotate(rawToken, ctx);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (rawToken) await this.tokens.revoke(rawToken);
  }
}
