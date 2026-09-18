import { Injectable } from '@nestjs/common';
import { LogVisibility, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { notFound } from '../common/errors';
import { isCustomer, type Principal } from '../common/principal';

/**
 * Reading the audit trail.
 *
 * Deliberately separate from `ActivityService`, which only writes. The two have
 * opposite risk profiles: a failed write is a monitoring problem, while a read
 * that returns one row too many is a disclosure. Keeping them apart means the
 * write path cannot grow a read method with the filters left off.
 *
 * Staff and customers get different methods rather than one method with a flag.
 * A shared query with an `if (isStaff)` inside it is one refactor away from
 * handing a customer the internal trail — the same reasoning behind two identity
 * tables instead of one with a realm column.
 */

/**
 * What makes an action security-sensitive: it concerns who can get in, or with
 * what credential.
 *
 * A rule over the action name, not a list of known actions. A list has to be
 * remembered when an action is added, and a forgotten entry quietly downgrades a
 * credential change to ordinary activity — the same failure as the SUPPORT_STAFF
 * permission bug. Over-matching is the safe direction: an action wrongly put in
 * the security trail is visible to fewer people, not more.
 */
const SECURITY_TERMS = [
  'auth.',
  'credential',
  'password',
  'passphrase',
  'token',
  'secret',
  'permission',
  'role',
  'impersonat',
  'sftp',
  'two_factor',
  'mfa',
  'session',
];

export function isSecurityAction(action: string): boolean {
  const lower = action.toLowerCase();
  return SECURITY_TERMS.some((term) => lower.includes(term));
}

/** The same rule, expressed for the database so paging and counting stay exact. */
const securityMatch: Prisma.ActivityLogWhereInput = {
  OR: SECURITY_TERMS.map((term) => ({
    action: { contains: term, mode: 'insensitive' as const },
  })),
};

export type ActivityQuery = {
  customerId?: string;
  action?: string;
  actorEmail?: string;
  resourceType?: string;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
};

const PAGE_MAX = 100;

@Injectable()
export class ActivityReadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ordinary staff activity: everything except the security trail.
   *
   * Two endpoints rather than one that silently drops rows the caller lacks the
   * permission for. A filtered trail that looks complete is worse than being
   * told the security trail is somewhere else.
   */
  listForStaff(query: ActivityQuery) {
    return this.page({ ...this.filters(query), NOT: securityMatch }, query);
  }

  /** The security trail, behind `admin.security_logs`. */
  listSecurityForStaff(query: ActivityQuery) {
    return this.page({ ...this.filters(query), ...securityMatch }, query);
  }

  /**
   * A customer's own trail.
   *
   * Two restrictions, both applied here and neither reachable from a request:
   * the tenant comes from the session, and only rows written as CUSTOMER-visible
   * are returned. INTERNAL rows record how WebEdge operates — which provider
   * account a site sits on, which staff member opened it — and are not a
   * customer's to read.
   */
  async listForCustomer(principal: Principal, options: { skip?: number; take?: number }) {
    const customerId = isCustomer(principal)
      ? principal.customerId
      : principal.impersonating?.customerId;
    // Not "forbidden": a staff session with no impersonation context has no
    // tenant, so there is no trail at this address for it to read.
    if (!customerId) throw notFound();

    const take = Math.min(Math.max(options.take ?? 25, 1), PAGE_MAX);
    const skip = Math.max(options.skip ?? 0, 0);
    const where: Prisma.ActivityLogWhereInput = {
      customerId,
      visibility: LogVisibility.CUSTOMER,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.activityLog.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.activityLog.count({ where }),
    ]);

    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        newValue: row.newValue,
        createdAt: row.createdAt,
        /**
         * Who acted, as far as a customer is concerned. Their own user is named;
         * a staff member is "WebEdge support". A staff address identifies a
         * named employee to an outside party, and is also a valid address to
         * attack.
         *
         * A row with no actor at all was written by a scheduled process — a
         * renewal, an expiry — and is named as one. Calling that "WebEdge
         * support" would tell the customer a person opened their account and
         * acted on it, which is not what happened, and is the sort of thing
         * they ask about when the charge is unexpected.
         */
        actor: ActivityReadService.actorFor(row),
      })),
    };
  }

  /** Named for a customer's eyes. See the comment at the call site. */
  private static actorFor(row: {
    customerUserId: string | null;
    adminUserId: string | null;
    actorEmail: string | null;
  }): string | null {
    if (row.customerUserId) return row.actorEmail;
    if (row.adminUserId || row.actorEmail) return 'WebEdge support';
    return 'WebEdge (automatic)';
  }

  private filters(query: ActivityQuery): Prisma.ActivityLogWhereInput {
    return {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
      ...(query.actorEmail
        ? { actorEmail: { contains: query.actorEmail, mode: 'insensitive' } }
        : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };
  }

  private async page(where: Prisma.ActivityLogWhereInput, query: ActivityQuery) {
    const take = Math.min(Math.max(query.take ?? 25, 1), PAGE_MAX);
    const skip = Math.max(query.skip ?? 0, 0);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.activityLog.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.activityLog.count({ where }),
    ]);

    return { items, total };
  }
}
