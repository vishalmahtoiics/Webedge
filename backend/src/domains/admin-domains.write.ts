import { Injectable } from '@nestjs/common';
import { DiscoveredKind, DomainStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { AppError, notFound } from '../common/errors';
import { isValidDomainName } from '../dns/dns-validation';
import type { Principal } from '../common/principal';

/**
 * Creating a domain, and attaching a discovered one to a customer.
 *
 * Both end at the same place — a `Domain` row with a tenant — and the tenant is
 * why they are careful. Attaching a domain to the wrong customer hands one
 * person control of another's DNS, and `TenantScope` cannot undo it afterwards
 * because, as far as every later query is concerned, the row is theirs.
 */
@Injectable()
export class AdminDomainsWriteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  /**
   * Attaches a domain found on the provider to a customer.
   *
   * The discovered row is kept and marked claimed rather than moved: it is the
   * record that this domain is on that provider account, which stays true and
   * is what a later sync matches on. Deleting it would make the next sync
   * create it again as unassigned.
   */
  async claim(principal: Principal, discoveredId: string, customerId: string) {
    const [resource, customer] = await Promise.all([
      this.prisma.discoveredResource.findUnique({ where: { id: discoveredId } }),
      this.prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, fullName: true, companyName: true },
      }),
    ]);

    if (!resource) throw notFound('discovered resource');
    if (!customer) throw notFound('customer');
    if (resource.kind !== DiscoveredKind.DOMAIN) {
      throw new AppError('INVALID_REQUEST', 'That resource is not a domain.');
    }
    if (resource.name === null) {
      throw new AppError(
        'INVALID_REQUEST',
        'That resource has no readable name, so there is nothing to attach. ' +
          'Correct the field mapping and sync again.',
      );
    }

    const existing = await this.prisma.domain.findUnique({
      where: { name: resource.name },
      select: { customerId: true },
    });
    if (existing) {
      // Never silently reassigned. Moving a domain between customers moves
      // its DNS with it, and doing that by accident is not recoverable by
      // moving it back — the records are already live.
      throw new AppError(
        'CONFLICT',
        existing.customerId === customerId
          ? 'That domain is already assigned to this customer.'
          : 'That domain already belongs to another customer. Detach it there first.',
      );
    }

    const domain = await this.prisma.$transaction(async (tx) => {
      const created = await tx.domain.create({
        data: {
          name: resource.name!,
          customerId,
          // The provider's own word where it gave one; otherwise the
          // conservative default rather than an assumption that it is live.
          status: mapStatus(resource.status),
          expiresAt: resource.expiresAt,
          dnsManaged: false,
        },
      });
      await tx.discoveredResource.update({
        where: { id: discoveredId },
        data: { claimedByCustomerId: customerId },
      });
      return created;
    });

    await this.activity.record(principal, {
      action: 'admin.domain.assigned',
      customerId,
      resourceType: 'domain',
      resourceId: domain.id,
      visibility: 'CUSTOMER',
      newValue: {
        domain: domain.name,
        customer: customer.companyName ?? customer.fullName,
        source: 'provider',
      },
    });

    return domain;
  }

  /** Adds a domain registered elsewhere, or one being set up ahead of time. */
  async create(
    principal: Principal,
    input: {
      name: string;
      customerId: string;
      status?: DomainStatus;
      expiresAt?: string;
      registrar?: string;
      nameservers?: string[];
      dnsManaged?: boolean;
    },
  ) {
    const name = input.name.trim().toLowerCase();

    // The same validation the DNS module uses, rather than a second regex that
    // will drift from it.
    if (!isValidDomainName(name)) {
      throw new AppError('INVALID_REQUEST', 'That is not a valid domain name.');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true, fullName: true, companyName: true },
    });
    if (!customer) throw notFound('customer');

    const [sold, discovered] = await Promise.all([
      this.prisma.domain.findUnique({ where: { name }, select: { id: true } }),
      this.prisma.discoveredResource.findFirst({
        where: { kind: DiscoveredKind.DOMAIN, name },
        select: { id: true },
      }),
    ]);

    if (sold) {
      throw new AppError('CONFLICT', 'That domain is already assigned to a customer.');
    }
    if (discovered) {
      // Naming which, because the action differs: this one should be attached,
      // not created, and creating it would leave two records of one domain.
      throw new AppError(
        'CONFLICT',
        'That domain is already on a connected provider account. Assign it from there instead.',
      );
    }

    const domain = await this.prisma.domain.create({
      data: {
        name,
        customerId: input.customerId,
        status: input.status ?? DomainStatus.ACTIVE,
        // An unknown expiry stays null. A date invented here would be shown as
        // fact on a renewal screen.
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        registrar: input.registrar?.trim() || null,
        nameservers: input.nameservers ?? [],
        dnsManaged: input.dnsManaged ?? false,
      },
    });

    await this.activity.record(principal, {
      action: 'admin.domain.created',
      customerId: input.customerId,
      resourceType: 'domain',
      resourceId: domain.id,
      visibility: 'CUSTOMER',
      newValue: {
        domain: domain.name,
        customer: customer.companyName ?? customer.fullName,
        source: 'manual',
      },
    });

    return domain;
  }

  /** Detaches a domain from a customer, leaving any discovered record in place. */
  async detach(principal: Principal, domainId: string) {
    const domain = await this.prisma.domain.findUnique({
      where: { id: domainId },
      select: { id: true, name: true, customerId: true, _count: { select: { dnsRecords: true } } },
    });
    if (!domain) throw notFound('domain');

    if (domain._count.dnsRecords > 0) {
      // Detaching would orphan records that are live for this domain. Saying
      // how many, because the next question is always "how much would I lose".
      throw new AppError(
        'CONFLICT',
        `That domain has ${domain._count.dnsRecords} DNS record(s) in WebEdge. ` +
          'Remove them first if you mean to detach it.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.domain.delete({ where: { id: domainId } });
      await tx.discoveredResource.updateMany({
        where: { kind: DiscoveredKind.DOMAIN, name: domain.name },
        data: { claimedByCustomerId: null },
      });
    });

    await this.activity.record(principal, {
      action: 'admin.domain.detached',
      customerId: domain.customerId,
      resourceType: 'domain',
      resourceId: domainId,
      visibility: 'CUSTOMER',
      oldValue: { domain: domain.name },
    });
  }
}

/**
 * The provider's status word, mapped to WebEdge's.
 *
 * Anything unrecognised becomes PENDING rather than ACTIVE: treating an unknown
 * word as live is how a suspended domain is presented to a customer as working.
 */
function mapStatus(status: string | null): DomainStatus {
  switch (status?.toLowerCase()) {
    case 'active':
    case 'enabled':
      return DomainStatus.ACTIVE;
    case 'expired':
      return DomainStatus.EXPIRED;
    default:
      // Anything unrecognised — including a suspended or disabled domain, for
      // which WebEdge has no separate state — is pending verification rather
      // than active. Treating an unknown word as live is how a domain that is
      // not working is presented to a customer as working.
      return DomainStatus.PENDING_VERIFICATION;
  }
}
