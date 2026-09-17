import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from './errors';
import { isCustomer, type Principal } from './principal';

/**
 * Tenant-scoped data access.
 *
 * Every customer-facing read and write goes through here, and `customerId` comes
 * from the verified session — never from a route parameter, query string or
 * body. A handler cannot accidentally omit the scope, because there is no method
 * that takes a resource id without also taking the principal.
 *
 * A resource that belongs to another customer is reported as not found, never as
 * forbidden: a 403 confirms the id exists and lets an attacker enumerate other
 * customers' resources by watching which ids return 403 versus 404.
 */

/** The tenant-owned models reachable through this helper. */
type ScopedModel = 'website' | 'domain' | 'subscription' | 'notification';

@Injectable()
export class TenantScope {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the tenant a request acts on.
   *
   * For a customer this is their own id. For staff it is only set while
   * impersonating, so a staff session cannot reach customer data through this
   * helper by accident — staff read paths use their own services, guarded by
   * `admin.*` permissions.
   */
  static tenantIdOf(principal: Principal): string | undefined {
    if (isCustomer(principal)) return principal.customerId;
    return principal.impersonating?.customerId;
  }

  private requireTenant(principal: Principal): string {
    const customerId = TenantScope.tenantIdOf(principal);
    // Not "forbidden": a staff session with no impersonation context has no
    // tenant, and the resource genuinely is not addressable for it.
    if (!customerId) throw notFound();
    return customerId;
  }

  /**
   * Fetches one resource by id, scoped to the caller's tenant.
   *
   * The lookup is `(id, customerId)` rather than `id` followed by an ownership
   * check, so there is no window in which the wrong row has been read.
   */
  async findOwned<T>(
    principal: Principal,
    model: ScopedModel,
    id: string,
    // Free text rather than the model name: a DNS record is reached through its
    // domain, and the error should name what the caller asked for.
    resourceLabel: string = model,
  ): Promise<T> {
    const customerId = this.requireTenant(principal);

    // The Prisma delegates are a union of four differently-typed models, so a
    // structural cast is the only way to address them generically. Safe here
    // because every model in ScopedModel has customerId and these method shapes.
    const delegate = this.prisma[model] as unknown as {
      findFirst(args: unknown): Promise<T | null>;
    };
    const record = await delegate.findFirst({ where: { id, customerId } });

    if (!record) throw notFound(resourceLabel);
    return record;
  }

  /** Lists a tenant's resources. Pagination is enforced, with a hard ceiling. */
  async listOwned<T>(
    principal: Principal,
    model: ScopedModel,
    options: { skip?: number; take?: number; orderBy?: unknown; where?: Record<string, unknown> } = {},
  ): Promise<{ items: T[]; total: number }> {
    const customerId = this.requireTenant(principal);
    const take = Math.min(Math.max(options.take ?? 25, 1), 100);
    const skip = Math.max(options.skip ?? 0, 0);

    const delegate = this.prisma[model] as unknown as {
      findMany(args: unknown): Promise<T[]>;
      count(args: unknown): Promise<number>;
    };

    // The caller's `where` is spread first so it can never overwrite customerId.
    const where = { ...options.where, customerId };

    const [items, total] = await Promise.all([
      delegate.findMany({ where, skip, take, orderBy: options.orderBy ?? { createdAt: 'desc' } }),
      delegate.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * Confirms ownership before a mutation, returning the tenant id to write with.
   * Throws not-found if the resource is not the caller's.
   */
  async assertOwned(principal: Principal, model: ScopedModel, id: string): Promise<string> {
    await this.findOwned(principal, model, id);
    return this.requireTenant(principal);
  }
}
