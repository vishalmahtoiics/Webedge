import { Injectable } from '@nestjs/common';
import { DiscoveredKind, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Every domain WebEdge knows about, in one list, for staff.
 *
 * They arrive from two places and the difference is the point:
 *
 *  - **Sold.** A `Domain` row, owned by a customer, with DNS and everything
 *    else scoped to that tenant.
 *  - **On the account.** A `DiscoveredResource` found by a sync, belonging to
 *    the provider account and to nobody yet.
 *
 * Merging them into one page without saying which is which would be the worst
 * of both: a staff member would read the list as "our customers' domains" and
 * act on a name that no customer has ever been sold. So every row carries its
 * origin, and an unassigned domain says so rather than showing an empty owner
 * column that reads like missing data.
 *
 * A domain can legitimately appear as both — sold to a customer *and* present
 * on the provider account, which is the normal state once one is provisioned.
 * Those are folded into a single row, because two rows for one name is how
 * someone ends up deleting the one they were not looking at.
 */

export type AdminDomainRow = {
  name: string;
  /** The sold row, when there is one. Null for a domain nobody has been sold. */
  domainId: string | null;
  /** The discovered row, when a sync found it. What an assignment acts on. */
  discoveredId: string | null;
  /** Where WebEdge knows this from. Both means sold and present upstream. */
  origin: 'sold' | 'on-account' | 'both';
  status: string | null;
  expiresAt: Date | null;
  /** Null when no customer owns it yet. */
  customer: { id: string; name: string } | null;
  /** The provider account it sits on, when a sync has seen it. */
  account: { id: string; name: string } | null;
  /** True when WebEdge manages the zone and can write records. */
  dnsManaged: boolean;
  lastSeenAt: Date | null;
};

/** Every list endpoint has a ceiling. */
const PAGE_MAX = 100;

export type AdminDomainQuery = {
  search?: string;
  /** 'unassigned' is the queue: found upstream, sold to nobody. */
  owner?: 'all' | 'assigned' | 'unassigned';
  skip?: number;
  take?: number;
};

@Injectable()
export class AdminDomainsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminDomainQuery): Promise<{ total: number; items: AdminDomainRow[] }> {
    const take = Math.min(Math.max(query.take ?? 50, 1), PAGE_MAX);
    const skip = Math.max(query.skip ?? 0, 0);
    const search = query.search?.trim();

    const soldWhere: Prisma.DomainWhereInput = search
      ? { name: { contains: search, mode: 'insensitive' } }
      : {};
    const foundWhere: Prisma.DiscoveredResourceWhereInput = {
      kind: DiscoveredKind.DOMAIN,
      ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
    };

    // Both sides in full, then merged. The alternative — paginating each and
    // stitching the pages — cannot produce a correct total or a stable order,
    // because a name present on both sides is one row and neither query knows
    // that. Bounded by how many domains a reseller has, which is not a number
    // that needs a cursor.
    const [sold, found] = await Promise.all([
      this.prisma.domain.findMany({
        where: soldWhere,
        select: {
          id: true,
          name: true,
          status: true,
          expiresAt: true,
          dnsManaged: true,
          lastSyncedAt: true,
          customer: { select: { id: true, fullName: true, companyName: true } },
        },
      }),
      this.prisma.discoveredResource.findMany({
        where: foundWhere,
        select: {
          id: true,
          name: true,
          status: true,
          expiresAt: true,
          lastSeenAt: true,
          claimedByCustomerId: true,
          hostingAccount: { select: { id: true, accountName: true } },
        },
      }),
    ]);

    const rows = new Map<string, AdminDomainRow>();

    for (const domain of sold) {
      rows.set(domain.name.toLowerCase(), {
        name: domain.name,
        domainId: domain.id,
        discoveredId: null,
        origin: 'sold',
        status: domain.status,
        expiresAt: domain.expiresAt,
        customer: {
          id: domain.customer.id,
          name: domain.customer.companyName ?? domain.customer.fullName,
        },
        account: null,
        dnsManaged: domain.dnsManaged,
        lastSeenAt: domain.lastSyncedAt,
      });
    }

    for (const resource of found) {
      // A discovered row with no readable name cannot be matched to anything
      // and has no name to show, so it is left to the Infrastructure page,
      // which shows it as unnamed rather than dropping it.
      if (resource.name === null) continue;

      const key = resource.name.toLowerCase();
      const existing = rows.get(key);

      if (existing) {
        existing.origin = 'both';
        existing.discoveredId = resource.id;
        existing.account = resource.hostingAccount
          ? { id: resource.hostingAccount.id, name: resource.hostingAccount.accountName }
          : null;
        existing.lastSeenAt = resource.lastSeenAt;
        // The provider's status and expiry are the upstream truth, and the
        // local row may predate the last sync.
        existing.status = resource.status ?? existing.status;
        existing.expiresAt = resource.expiresAt ?? existing.expiresAt;
        continue;
      }

      rows.set(key, {
        name: resource.name,
        domainId: null,
        discoveredId: resource.id,
        origin: 'on-account',
        status: resource.status,
        expiresAt: resource.expiresAt,
        customer: null,
        account: resource.hostingAccount
          ? { id: resource.hostingAccount.id, name: resource.hostingAccount.accountName }
          : null,
        dnsManaged: false,
        lastSeenAt: resource.lastSeenAt,
      });
    }

    let items = [...rows.values()];

    if (query.owner === 'assigned') items = items.filter((row) => row.customer !== null);
    if (query.owner === 'unassigned') items = items.filter((row) => row.customer === null);

    // Unassigned first: it is the queue, and a page that buries the work under
    // two hundred settled rows is a page nobody uses to do the work.
    items.sort((a, b) => {
      if ((a.customer === null) !== (b.customer === null)) return a.customer === null ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { total: items.length, items: items.slice(skip, skip + take) };
  }
}
