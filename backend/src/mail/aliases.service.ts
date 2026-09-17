import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { MailDomainsService } from './mail-domains.service';
import { resolveAddress, wouldCreateLoop, type DomainRouting } from './mail-routing';
import {
  CATCH_ALL, isReservedLocalPart, isValidAddress, isValidLocalPart, normaliseAddress,
} from './mail-address';
import { AppError, notFound } from '../common/errors';
import type { Principal } from '../common/principal';

/**
 * Aliases, and the loop check that runs before every write.
 *
 * Postfix finds a cycle at delivery and bounces, which means the message was
 * already accepted: the sender believes it was sent, nobody receives it, and the
 * evidence is in a log nobody reads. So the cycle is refused here, before it can
 * exist — there is never a window in which mail loops.
 */
@Injectable()
export class AliasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly domains: MailDomainsService,
  ) {}

  async list(principal: Principal, domainId: string) {
    const domain = await this.domains.get(principal, domainId);

    const items = await this.prisma.mailAlias.findMany({
      where: { domainId: domain.id },
      orderBy: { localPart: 'asc' },
    });

    return {
      total: items.length,
      items: items.map((alias) => ({
        id: alias.id,
        localPart: alias.localPart,
        address: `${alias.localPart}@${domain.name}`,
        destinations: alias.destinations,
        isActive: alias.isActive,
        createdAt: alias.createdAt,
      })),
    };
  }

  async create(
    principal: Principal,
    domainId: string,
    input: { localPart: string; destinations: string[] },
  ) {
    const domain = await this.domains.requireActiveOwned(principal, domainId);
    const localPart = normaliseAddress(input.localPart);
    const destinations = this.checkDestinations(input.destinations);

    // `*` is the catch-all and the one local part that is not itself a valid
    // address, so it is allowed here and nowhere else.
    if (localPart !== CATCH_ALL && !isValidLocalPart(localPart, { forStorage: true })) {
      throw new AppError('INVALID_REQUEST', 'That is not a valid address name.');
    }
    if (isReservedLocalPart(localPart)) {
      throw new AppError('CONFLICT', `${localPart}@ is reserved and managed by WebEdge.`);
    }

    const [aliasClash, mailboxClash] = await Promise.all([
      this.prisma.mailAlias.findUnique({
        where: { domainId_localPart: { domainId: domain.id, localPart } },
        select: { id: true },
      }),
      this.prisma.mailbox.findUnique({
        where: { domainId_localPart: { domainId: domain.id, localPart } },
        select: { id: true },
      }),
    ]);
    if (aliasClash) throw new AppError('CONFLICT', `${localPart}@${domain.name} already exists.`);
    // A mailbox wins over an alias at delivery, so an alias behind one would
    // never fire — mail that appears to be forwarded and simply is not.
    if (mailboxClash) {
      throw new AppError(
        'CONFLICT',
        `${localPart}@${domain.name} is a mailbox, so an alias there would never be used.`,
      );
    }

    await this.assertNoLoop(`${localPart}@${domain.name}`, destinations);

    const alias = await this.prisma.mailAlias.create({
      data: { domainId: domain.id, localPart, destinations },
    });

    await this.activity.record(principal, {
      action: 'mail.alias.created',
      customerId: domain.customerId,
      resourceType: 'mail_alias',
      resourceId: alias.id,
      visibility: 'CUSTOMER',
      newValue: { address: `${localPart}@${domain.name}`, destinations },
    });

    return alias;
  }

  async update(
    principal: Principal,
    domainId: string,
    aliasId: string,
    input: { destinations?: string[]; isActive?: boolean },
  ) {
    const { domain, alias } = await this.owned(principal, domainId, aliasId);

    const destinations = input.destinations
      ? this.checkDestinations(input.destinations)
      : undefined;

    if (destinations) {
      await this.assertNoLoop(`${alias.localPart}@${domain.name}`, destinations);
    }

    const updated = await this.prisma.mailAlias.update({
      where: { id: alias.id },
      data: { ...(destinations ? { destinations } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) },
    });

    await this.activity.record(principal, {
      action: 'mail.alias.updated',
      customerId: domain.customerId,
      resourceType: 'mail_alias',
      resourceId: alias.id,
      visibility: 'CUSTOMER',
      oldValue: { destinations: alias.destinations },
      newValue: { destinations: updated.destinations },
    });

    return updated;
  }

  async remove(principal: Principal, domainId: string, aliasId: string) {
    const { domain, alias } = await this.owned(principal, domainId, aliasId);

    await this.activity.record(principal, {
      action: 'mail.alias.deleted',
      customerId: domain.customerId,
      resourceType: 'mail_alias',
      resourceId: alias.id,
      oldValue: {
        address: `${alias.localPart}@${domain.name}`,
        destinations: alias.destinations,
      },
    });

    await this.prisma.mailAlias.delete({ where: { id: alias.id } });
    return { removed: true };
  }

  /**
   * Where an address actually delivers, for the customer to check.
   *
   * The question support is asked when someone says mail is going missing, and
   * cheaper to answer from here than by reading Postfix maps.
   */
  async trace(principal: Principal, domainId: string, address: string) {
    const domain = await this.domains.get(principal, domainId);
    const routing = await this.routingFor();

    return resolveAddress(address, routing);
  }

  private checkDestinations(destinations: string[]): string[] {
    const cleaned = [...new Set(destinations.map(normaliseAddress).filter(Boolean))];

    if (cleaned.length === 0) {
      throw new AppError('INVALID_REQUEST', 'An alias needs at least one destination.');
    }
    if (cleaned.length > 50) {
      throw new AppError('INVALID_REQUEST', 'An alias can have at most 50 destinations.');
    }

    for (const destination of cleaned) {
      if (!isValidAddress(destination)) {
        throw new AppError('INVALID_REQUEST', `${destination} is not a valid email address.`);
      }
    }

    return cleaned;
  }

  /**
   * Builds the routing table for the loop check.
   *
   * Every domain is loaded, not just this one, because a cycle can run out
   * through another domain and back: `hub@a.test -> spoke@b.test -> hub@a.test`
   * is invisible to a check that only reads one domain's aliases.
   */
  private async routingFor() {
    const domains = await this.prisma.mailDomain.findMany({
      select: {
        name: true,
        mailboxes: { select: { localPart: true } },
        aliases: { select: { localPart: true, destinations: true } },
      },
    });

    const map = new Map<string, DomainRouting>();
    for (const domain of domains) {
      map.set(domain.name, {
        mailboxes: new Set(domain.mailboxes.map((m) => m.localPart)),
        aliases: new Map(domain.aliases.map((a) => [a.localPart, a.destinations])),
      });
    }

    return map;
  }

  private async assertNoLoop(address: string, destinations: string[]) {
    const routing = await this.routingFor();
    const loop = wouldCreateLoop(address, destinations, routing);

    if (loop) {
      throw new AppError(
        'CONFLICT',
        `That would create a mail loop: ${loop.join(' → ')}. Mail sent there would bounce.`,
        { loop },
      );
    }
  }

  private async owned(principal: Principal, domainId: string, aliasId: string) {
    const domain = await this.domains.get(principal, domainId);
    const alias = await this.prisma.mailAlias.findFirst({
      where: { id: aliasId, domainId: domain.id },
    });
    if (!alias) throw notFound('alias');

    return { domain, alias };
  }
}
