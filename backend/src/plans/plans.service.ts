import { Injectable } from '@nestjs/common';
import { BillingCycle, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { AppError, notFound } from '../common/errors';
import type { Principal } from '../common/principal';

/**
 * Hosting plans.
 *
 * Note what is missing: there is no delete. A plan that has ever been sold is
 * referenced by subscriptions and by the invoices that charged for it, and
 * removing it would leave both pointing at nothing — the schema's
 * `onDelete: Restrict` would refuse anyway. Withdrawing a plan is deactivation,
 * which stops new sales and leaves existing customers on what they bought.
 */

export type PlanInput = {
  name: string;
  slug: string;
  description?: string | null;
  priceInPaise: number;
  billingCycle: BillingCycle;
  isPublic?: boolean;
  maxWebsites?: number | null;
  maxDomains?: number | null;
  maxDatabases?: number | null;
  maxMailboxes?: number | null;
  storageGb?: number | null;
  mailboxQuotaGb?: number | null;
  providerProduct?: string | null;
};

/**
 * What a customer is allowed to see.
 *
 * `providerProduct` is the upstream product a plan is fulfilled by, and naming
 * it would say who the provider is — the one thing a white-label panel must not
 * do. It is excluded by not selecting it, rather than deleted afterwards, so a
 * future field cannot arrive in a customer's response by default.
 */
const PUBLIC_FIELDS = {
  id: true,
  name: true,
  slug: true,
  description: true,
  priceInPaise: true,
  billingCycle: true,
  maxWebsites: true,
  maxDomains: true,
  maxDatabases: true,
  maxMailboxes: true,
  storageGb: true,
  mailboxQuotaGb: true,
} satisfies Prisma.HostingPlanSelect;

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  /** The staff view: every plan, including withdrawn ones. */
  async list(options: { includeInactive?: boolean; skip?: number; take?: number } = {}) {
    const take = Math.min(Math.max(options.take ?? 50, 1), 100);
    const skip = Math.max(options.skip ?? 0, 0);
    const where: Prisma.HostingPlanWhereInput = options.includeInactive
      ? {}
      : { isActive: true };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.hostingPlan.findMany({
        where,
        skip,
        take,
        orderBy: [{ isActive: 'desc' }, { priceInPaise: 'asc' }],
        include: { _count: { select: { subscriptions: true } } },
      }),
      this.prisma.hostingPlan.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * The catalogue a customer sees: active, public, and without the upstream
   * product. A plan that is active but not public still bills correctly for the
   * customers on it — that is how a withdrawn or negotiated price keeps working.
   */
  async listPublic() {
    const items = await this.prisma.hostingPlan.findMany({
      where: { isActive: true, isPublic: true },
      orderBy: { priceInPaise: 'asc' },
      select: PUBLIC_FIELDS,
    });

    return { items, total: items.length };
  }

  async get(id: string) {
    const plan = await this.prisma.hostingPlan.findUnique({
      where: { id },
      include: { _count: { select: { subscriptions: true } } },
    });
    if (!plan) throw notFound('plan');
    return plan;
  }

  async create(principal: Principal, input: PlanInput) {
    const slug = input.slug.trim().toLowerCase();

    const existing = await this.prisma.hostingPlan.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (existing) {
      throw new AppError('CONFLICT', 'A plan with that slug already exists.');
    }

    const plan = await this.prisma.hostingPlan.create({
      data: { ...input, slug },
    });

    await this.activity.record(principal, {
      action: 'admin.plan.created',
      resourceType: 'plan',
      resourceId: plan.id,
      newValue: { name: plan.name, slug: plan.slug, priceInPaise: plan.priceInPaise },
    });

    return plan;
  }

  /**
   * Updates a plan.
   *
   * The price and cycle can change, and that deliberately does not touch
   * anything already sold: an invoice records what was charged at the time, and
   * a subscription renews at the price in force when it renews. Repricing
   * retroactively would make issued invoices disagree with the plan they cite.
   */
  async update(principal: Principal, id: string, input: Partial<PlanInput>) {
    const before = await this.get(id);

    if (input.slug && input.slug.trim().toLowerCase() !== before.slug) {
      const clash = await this.prisma.hostingPlan.findUnique({
        where: { slug: input.slug.trim().toLowerCase() },
        select: { id: true },
      });
      if (clash) throw new AppError('CONFLICT', 'A plan with that slug already exists.');
    }

    const plan = await this.prisma.hostingPlan.update({
      where: { id },
      data: { ...input, ...(input.slug ? { slug: input.slug.trim().toLowerCase() } : {}) },
    });

    await this.activity.record(principal, {
      action: 'admin.plan.updated',
      resourceType: 'plan',
      resourceId: id,
      oldValue: { priceInPaise: before.priceInPaise, billingCycle: before.billingCycle },
      newValue: { priceInPaise: plan.priceInPaise, billingCycle: plan.billingCycle },
    });

    return plan;
  }

  /** Withdraws a plan from sale, or puts it back. Existing customers are untouched. */
  async setActive(principal: Principal, id: string, isActive: boolean) {
    const before = await this.get(id);
    if (before.isActive === isActive) return before;

    const plan = await this.prisma.hostingPlan.update({ where: { id }, data: { isActive } });

    await this.activity.record(principal, {
      action: isActive ? 'admin.plan.reinstated' : 'admin.plan.withdrawn',
      resourceType: 'plan',
      resourceId: id,
      newValue: {
        name: plan.name,
        // Said plainly in the trail: withdrawing a plan with live subscriptions
        // is legitimate, but it is the thing someone will ask about later.
        activeSubscriptions: before._count.subscriptions,
      },
    });

    return plan;
  }
}
