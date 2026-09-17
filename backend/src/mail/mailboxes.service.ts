import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { PlanLimitsService } from '../plans/plan-limits.service';
import { MailDomainsService } from './mail-domains.service';
import { hashMailboxPassword } from './mail-password';
import { isReservedLocalPart, isValidLocalPart, normaliseAddress } from './mail-address';
import { AppError, notFound } from '../common/errors';
import type { Principal } from '../common/principal';

/**
 * Mailboxes.
 *
 * `Mailbox` has no `customerId`: its tenant is the domain's. Every method here
 * therefore starts by resolving the domain through `MailDomainsService`, which
 * goes through `TenantScope` — so a mailbox cannot be reached without first
 * proving the domain belongs to the caller, and there is no code path that takes
 * a mailbox id alone.
 */

/** What a mailbox looks like on the way out. The hash is not on this list. */
const MAILBOX_FIELDS = {
  id: true,
  localPart: true,
  displayName: true,
  quotaMib: true,
  usedMib: true,
  usageSyncedAt: true,
  isActive: true,
  createdAt: true,
} as const;

@Injectable()
export class MailboxesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly domains: MailDomainsService,
    private readonly limits: PlanLimitsService,
  ) {}

  async list(principal: Principal, domainId: string, options: { skip?: number; take?: number } = {}) {
    const domain = await this.domains.get(principal, domainId);
    const take = Math.min(Math.max(options.take ?? 50, 1), 100);
    const skip = Math.max(options.skip ?? 0, 0);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.mailbox.findMany({
        where: { domainId: domain.id },
        orderBy: { localPart: 'asc' },
        skip,
        take,
        select: MAILBOX_FIELDS,
      }),
      this.prisma.mailbox.count({ where: { domainId: domain.id } }),
    ]);

    return {
      total,
      items: items.map((mailbox) => ({
        ...mailbox,
        address: `${mailbox.localPart}@${domain.name}`,
        // Usage comes from the mail server. Null means never measured, and is
        // reported as such rather than as zero — a mailbox nobody has counted
        // and an empty mailbox are different facts.
        usedMib: mailbox.usedMib,
      })),
    };
  }

  /**
   * Creates a mailbox.
   *
   * This is the first resource-creation path in the codebase, so it is where
   * plan limits start being enforced: `maxMailboxes` has been on `HostingPlan`
   * since the schema was written with nothing checking it.
   */
  async create(
    principal: Principal,
    domainId: string,
    input: { localPart: string; password: string; displayName?: string; quotaMib?: number },
  ) {
    const domain = await this.domains.requireActiveOwned(principal, domainId);
    const localPart = normaliseAddress(input.localPart);

    if (!isValidLocalPart(localPart, { forStorage: true })) {
      throw new AppError(
        'INVALID_REQUEST',
        'Use letters, digits, dots, underscores and hyphens, starting and ending with a letter or digit.',
      );
    }

    // `postmaster` and `abuse` must reach someone who can act on a report, and
    // the addresses a certificate authority accepts as proof of domain control
    // must not go to whoever claims them first.
    if (isReservedLocalPart(localPart)) {
      throw new AppError('CONFLICT', `${localPart}@ is reserved and managed by WebEdge.`);
    }

    const clash = await this.prisma.mailbox.findUnique({
      where: { domainId_localPart: { domainId: domain.id, localPart } },
      select: { id: true },
    });
    if (clash) throw new AppError('CONFLICT', `${localPart}@${domain.name} already exists.`);

    // An alias with the same name would be shadowed by the mailbox and stop
    // working silently, which reads as mail going missing.
    const aliasClash = await this.prisma.mailAlias.findUnique({
      where: { domainId_localPart: { domainId: domain.id, localPart } },
      select: { id: true },
    });
    if (aliasClash) {
      throw new AppError(
        'CONFLICT',
        `${localPart}@${domain.name} is an alias. Remove it first, or choose another name.`,
      );
    }

    await this.limits.assertCanCreate(domain.customerId, 'maxMailboxes');

    const mailbox = await this.prisma.mailbox.create({
      data: {
        domainId: domain.id,
        localPart,
        passwordHash: await hashMailboxPassword(input.password),
        displayName: input.displayName ?? null,
        quotaMib: input.quotaMib ?? domain.quotaMib ?? null,
      },
      select: MAILBOX_FIELDS,
    });

    await this.activity.record(principal, {
      action: 'mail.mailbox.created',
      customerId: domain.customerId,
      resourceType: 'mailbox',
      resourceId: mailbox.id,
      visibility: 'CUSTOMER',
      // No password field, and none of its derivatives. The audit trail records
      // that a mailbox was made, never what it was made with.
      newValue: { address: `${localPart}@${domain.name}`, quotaMib: mailbox.quotaMib },
    });

    return { ...mailbox, address: `${localPart}@${domain.name}` };
  }

  async update(
    principal: Principal,
    domainId: string,
    mailboxId: string,
    input: { displayName?: string | null; quotaMib?: number | null; isActive?: boolean },
  ) {
    const { domain, mailbox } = await this.owned(principal, domainId, mailboxId);

    const updated = await this.prisma.mailbox.update({
      where: { id: mailbox.id },
      data: input,
      select: MAILBOX_FIELDS,
    });

    await this.activity.record(principal, {
      action: 'mail.mailbox.updated',
      customerId: domain.customerId,
      resourceType: 'mailbox',
      resourceId: mailbox.id,
      visibility: 'CUSTOMER',
      oldValue: { quotaMib: mailbox.quotaMib, isActive: mailbox.isActive },
      newValue: { quotaMib: updated.quotaMib, isActive: updated.isActive },
    });

    return { ...updated, address: `${updated.localPart}@${domain.name}` };
  }

  /**
   * Sets a new password.
   *
   * There is no "show me the current password" anywhere: the stored value is an
   * argon2id hash and nothing here can reverse it. A forgotten mailbox password
   * is reset, the same rule as for account passwords.
   */
  async setPassword(principal: Principal, domainId: string, mailboxId: string, password: string) {
    const { domain, mailbox } = await this.owned(principal, domainId, mailboxId);

    await this.prisma.mailbox.update({
      where: { id: mailbox.id },
      data: { passwordHash: await hashMailboxPassword(password) },
    });

    await this.activity.record(principal, {
      action: 'mail.mailbox.password_changed',
      customerId: domain.customerId,
      resourceType: 'mailbox',
      resourceId: mailbox.id,
      visibility: 'CUSTOMER',
      newValue: { address: `${mailbox.localPart}@${domain.name}` },
    });

    return { changed: true };
  }

  /**
   * Deletes a mailbox.
   *
   * The address is typed back to confirm. Deleting a mailbox deletes the mail in
   * it, and there is no undo — a dialog gets dismissed by reflex, an address has
   * to be read before it can be typed.
   */
  async remove(principal: Principal, domainId: string, mailboxId: string, confirmAddress: string) {
    const { domain, mailbox } = await this.owned(principal, domainId, mailboxId);
    const address = `${mailbox.localPart}@${domain.name}`;

    if (normaliseAddress(confirmAddress) !== address) {
      throw new AppError(
        'INVALID_REQUEST',
        'Type the full address to confirm. This deletes the mail in the mailbox.',
      );
    }

    // Aliases pointing here would silently stop delivering, so they are named
    // rather than left for someone to discover.
    const orphaned = await this.prisma.mailAlias.findMany({
      where: { domainId: domain.id, destinations: { has: address } },
      select: { localPart: true },
    });

    await this.activity.record(principal, {
      action: 'mail.mailbox.deleted',
      customerId: domain.customerId,
      resourceType: 'mailbox',
      resourceId: mailbox.id,
      oldValue: { address, orphanedAliases: orphaned.map((a) => a.localPart) },
    });

    await this.prisma.mailbox.delete({ where: { id: mailbox.id } });

    return {
      removed: true,
      orphanedAliases: orphaned.map((alias) => `${alias.localPart}@${domain.name}`),
    };
  }

  /**
   * The one way to address a mailbox: through a domain the caller owns.
   *
   * Looked up by `(id, domainId)` rather than by id followed by an ownership
   * check, so there is no window in which the wrong row has been read.
   */
  private async owned(principal: Principal, domainId: string, mailboxId: string) {
    const domain = await this.domains.get(principal, domainId);
    const mailbox = await this.prisma.mailbox.findFirst({
      where: { id: mailboxId, domainId: domain.id },
    });
    if (!mailbox) throw notFound('mailbox');

    return { domain, mailbox };
  }
}
