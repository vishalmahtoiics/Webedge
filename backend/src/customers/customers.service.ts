import { Injectable } from '@nestjs/common';
import { AccountStatus, Prisma, Realm } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { AuthService } from '../auth/auth.service';
import { AppError, invalidRequest, notFound } from '../common/errors';
import type { Principal } from '../common/principal';

/**
 * Customer administration (blueprint §5).
 *
 * Creating a customer creates both the tenant and its first login in one
 * transaction: a tenant with no way to sign in is not a useful half-state, and
 * leaving it behind on a partial failure means staff have to clean it up by hand.
 */

export type CustomerListItem = {
  id: string;
  fullName: string;
  companyName: string | null;
  email: string;
  status: AccountStatus;
  createdAt: Date;
  websiteCount: number;
  domainCount: number;
  activePlan: string | null;
};

const PAGE_MAX = 100;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async list(options: {
    search?: string;
    status?: AccountStatus;
    skip?: number;
    take?: number;
  }): Promise<{ items: CustomerListItem[]; total: number }> {
    const take = Math.min(Math.max(options.take ?? 25, 1), PAGE_MAX);
    const skip = Math.max(options.skip ?? 0, 0);

    const where: Prisma.CustomerWhereInput = {
      ...(options.status ? { status: options.status } : {}),
      ...(options.search
        ? {
            OR: [
              { fullName: { contains: options.search, mode: 'insensitive' } },
              { companyName: { contains: options.search, mode: 'insensitive' } },
              { email: { contains: options.search, mode: 'insensitive' } },
              { gstin: { contains: options.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [customers, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { websites: true, domains: true } },
          subscriptions: {
            where: { status: 'ACTIVE' },
            take: 1,
            orderBy: { createdAt: 'desc' },
            include: { plan: { select: { name: true } } },
          },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      total,
      items: customers.map((c) => ({
        id: c.id,
        fullName: c.fullName,
        companyName: c.companyName,
        email: c.email,
        status: c.status,
        createdAt: c.createdAt,
        websiteCount: c._count.websites,
        domainCount: c._count.domains,
        activePlan: c.subscriptions[0]?.plan.name ?? null,
      })),
    };
  }

  async get(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        users: {
          // Password hashes must never leave the service layer, so the columns
          // are not selected rather than deleted afterwards.
          select: {
            id: true,
            email: true,
            fullName: true,
            status: true,
            lastLoginAt: true,
            createdAt: true,
          },
        },
        websites: { select: { id: true, domain: true, status: true, createdAt: true } },
        domains: { select: { id: true, name: true, status: true, expiresAt: true } },
        subscriptions: { include: { plan: { select: { name: true, slug: true } } } },
      },
    });

    if (!customer) throw notFound('customer');
    return customer;
  }

  /**
   * Creates a customer and its first user together.
   *
   * Returns a one-time password when none is supplied; it is shown once in the
   * admin UI and never stored in plaintext or written to the audit trail.
   */
  async create(
    principal: Principal,
    input: {
      fullName: string;
      email: string;
      companyName?: string;
      phone?: string;
      billingState?: string;
      gstin?: string;
      password?: string;
    },
  ): Promise<{ id: string; userId: string; temporaryPassword?: string }> {
    const email = input.email.toLowerCase().trim();

    // Checked up front for a clear message; the unique constraints below are
    // what actually guarantee it under concurrency.
    const [existingCustomer, existingUser] = await Promise.all([
      this.prisma.customer.findUnique({ where: { email }, select: { id: true } }),
      this.prisma.customerUser.findUnique({ where: { email }, select: { id: true } }),
    ]);
    if (existingCustomer || existingUser) {
      throw new AppError('CONFLICT', 'An account with that email address already exists.');
    }

    const role = await this.prisma.role.findFirst({
      where: { realm: Realm.CUSTOMER, name: 'CUSTOMER' },
    });
    if (!role) {
      throw new AppError('OPERATION_FAILED', 'Customer role is missing. Run the seed.');
    }

    const generated = input.password ? undefined : randomBytes(12).toString('base64url');
    const passwordHash = await AuthService.hashPassword(input.password ?? generated!);

    const result = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          fullName: input.fullName,
          companyName: input.companyName ?? null,
          email,
          phone: input.phone ?? null,
          billingState: input.billingState ?? null,
          gstin: input.gstin ?? null,
          // Staff-created accounts are active immediately; self-signup will
          // start at PENDING_VERIFICATION instead.
          status: AccountStatus.ACTIVE,
        },
      });

      const user = await tx.customerUser.create({
        data: {
          customerId: customer.id,
          email,
          fullName: input.fullName,
          passwordHash,
          roleId: role.id,
          status: AccountStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });

      return { customerId: customer.id, userId: user.id };
    });

    await this.activity.record(principal, {
      action: 'admin.customer.created',
      customerId: result.customerId,
      resourceType: 'customer',
      resourceId: result.customerId,
      // No password field here, generated or supplied.
      newValue: { fullName: input.fullName, email, companyName: input.companyName },
    });

    return { id: result.customerId, userId: result.userId, temporaryPassword: generated };
  }

  async setStatus(
    principal: Principal,
    customerId: string,
    status: AccountStatus,
    reason: string,
  ): Promise<void> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw notFound('customer');
    if (!reason.trim()) throw invalidRequest('A reason is required to change a customer status.');

    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: customerId }, data: { status } });

      // Suspension must end existing sessions, not just block new sign-ins:
      // otherwise a suspended customer keeps working until their token expires.
      if (status !== AccountStatus.ACTIVE) {
        const users = await tx.customerUser.findMany({
          where: { customerId },
          select: { id: true },
        });
        await tx.refreshToken.updateMany({
          where: { customerUserId: { in: users.map((u) => u.id) }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });

    await this.activity.record(principal, {
      action: 'admin.customer.status_changed',
      customerId,
      resourceType: 'customer',
      resourceId: customerId,
      oldValue: { status: customer.status },
      newValue: { status, reason },
    });
  }

  /** Assigns a plan. Existing active subscriptions are cancelled, not stacked. */
  async assignPlan(
    principal: Principal,
    customerId: string,
    planId: string,
  ): Promise<{ subscriptionId: string }> {
    const [customer, plan] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }),
      this.prisma.hostingPlan.findUnique({ where: { id: planId } }),
    ]);
    if (!customer) throw notFound('customer');
    if (!plan) throw notFound('plan');

    const renewsAt = new Date();
    const months =
      plan.billingCycle === 'MONTHLY'
        ? 1
        : plan.billingCycle === 'QUARTERLY'
          ? 3
          : plan.billingCycle === 'YEARLY'
            ? 12
            : plan.billingCycle === 'BIENNIAL'
              ? 24
              : 36;
    renewsAt.setMonth(renewsAt.getMonth() + months);

    const subscription = await this.prisma.$transaction(async (tx) => {
      await tx.subscription.updateMany({
        where: { customerId, status: 'ACTIVE' },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });

      return tx.subscription.create({
        data: { customerId, planId, status: 'ACTIVE', renewsAt },
      });
    });

    await this.activity.record(principal, {
      action: 'admin.customer.plan_assigned',
      customerId,
      resourceType: 'subscription',
      resourceId: subscription.id,
      newValue: { plan: plan.name, renewsAt },
    });

    return { subscriptionId: subscription.id };
  }
}
