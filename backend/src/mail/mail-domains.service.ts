import { Injectable, Logger } from '@nestjs/common';
import { MailDomainStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { TenantScope } from '../common/tenant-scope';
import { AppError, notFound } from '../common/errors';
import { isValidDomain, normaliseAddress } from './mail-address';
import type { Principal } from '../common/principal';

/**
 * Mail domains, and proving they belong to the customer claiming them.
 *
 * The verification step is not paperwork. Without it, one customer adds another
 * customer's domain, WebEdge starts accepting mail for it, and — once the MX
 * records point here — reads their mail. It is the worst failure this platform
 * has available and the easiest one to build by accident, so a domain accepts no
 * mail until control is proved.
 */

/** Where the proof is published. A subdomain, so it cannot collide with the
 *  domain's own TXT records — SPF and DMARC live at names of their own. */
export const VERIFICATION_HOST = '_webedge-challenge';
export const VERIFICATION_PREFIX = 'webedge-domain-verification=';

@Injectable()
export class MailDomainsService {
  private readonly logger = new Logger(MailDomainsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly scope: TenantScope,
  ) {}

  /**
   * The record the customer must publish.
   *
   * Random and per domain. It is meant to be public — anyone can read a TXT
   * record — but unguessable, so it cannot be published in advance by someone
   * who does not control the domain and does not yet know the token.
   */
  static newToken(): string {
    return randomBytes(24).toString('base64url');
  }

  async list(principal: Principal, options: { skip?: number; take?: number } = {}) {
    return this.scope.listOwned(principal, 'mailDomain', {
      ...options,
      orderBy: { name: 'asc' },
    });
  }

  async get(principal: Principal, id: string) {
    const domain = await this.scope.findOwned<{ id: string }>(
      principal,
      'mailDomain',
      id,
      'mail domain',
    );

    return this.prisma.mailDomain.findUniqueOrThrow({
      where: { id: domain.id },
      include: { _count: { select: { mailboxes: true, aliases: true } } },
    });
  }

  /**
   * Claims a domain, pending proof.
   *
   * The name is globally unique, so a second customer claiming a domain someone
   * already holds is refused. The refusal deliberately does not say who holds it
   * — that would confirm which domains are customers of WebEdge, and to whom.
   */
  async add(principal: Principal, customerId: string, name: string) {
    const domain = normaliseAddress(name);

    if (!isValidDomain(domain)) {
      throw new AppError('INVALID_REQUEST', 'Enter a valid domain name, such as example.com.');
    }

    const existing = await this.prisma.mailDomain.findUnique({
      where: { name: domain },
      select: { id: true, customerId: true },
    });
    if (existing) {
      throw new AppError(
        'CONFLICT',
        existing.customerId === customerId
          ? 'That domain is already on your account.'
          : 'That domain has already been claimed. Contact support if it is yours.',
      );
    }

    const created = await this.prisma.mailDomain.create({
      data: {
        customerId,
        name: domain,
        status: MailDomainStatus.PENDING_VERIFICATION,
        verificationToken: MailDomainsService.newToken(),
      },
    });

    await this.activity.record(principal, {
      action: 'mail.domain.added',
      customerId,
      resourceType: 'mail_domain',
      resourceId: created.id,
      visibility: 'CUSTOMER',
      newValue: { name: domain },
    });

    return created;
  }

  /**
   * Checks the published TXT record and activates the domain if it matches.
   *
   * The token is compared against every TXT value at the challenge host, because
   * a domain may legitimately carry several. Matching is exact on the full
   * string: a prefix match would let a record that merely starts with the token
   * pass.
   */
  async verify(principal: Principal, id: string) {
    const domain = await this.get(principal, id);

    if (domain.status === MailDomainStatus.ACTIVE) return domain;

    const expected = `${VERIFICATION_PREFIX}${domain.verificationToken}`;
    const host = `${VERIFICATION_HOST}.${domain.name}`;

    let records: string[][];
    try {
      const resolver = new Resolver({ timeout: 5_000, tries: 2 });
      records = await resolver.resolveTxt(host);
    } catch (error) {
      // A missing record and a broken resolver are different problems and the
      // customer needs to be told which: one is "publish the record", the other
      // is "try again".
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOTFOUND' || code === 'ENODATA') {
        throw new AppError(
          'INVALID_REQUEST',
          `No verification record found at ${host}. DNS changes can take a few minutes to appear.`,
          { host, expected },
        );
      }
      this.logger.warn(`DNS lookup failed for ${host}: ${String(error)}`);
      throw new AppError(
        'OPERATION_FAILED',
        'We could not read the DNS record just now. Try again in a moment.',
        { host, expected },
      );
    }

    // A long TXT value arrives split into 255-character chunks, which must be
    // joined before comparing — a token split across chunks matches nothing.
    const values = records.map((chunks) => chunks.join(''));
    if (!values.includes(expected)) {
      throw new AppError(
        'INVALID_REQUEST',
        `The record at ${host} does not match. Check it was published exactly as shown.`,
        { host, expected },
      );
    }

    const verified = await this.prisma.mailDomain.update({
      where: { id: domain.id },
      data: { status: MailDomainStatus.ACTIVE, verifiedAt: new Date() },
    });

    await this.activity.record(principal, {
      action: 'mail.domain.verified',
      customerId: domain.customerId,
      resourceType: 'mail_domain',
      resourceId: domain.id,
      visibility: 'CUSTOMER',
      newValue: { name: domain.name },
    });

    return verified;
  }

  /**
   * Resolves a domain the caller owns and which is ready to carry mail.
   *
   * Every mailbox and alias operation goes through here. `Mailbox` has no
   * `customerId` of its own — its tenant is the domain's — so this is the only
   * way to reach one, and a mailbox cannot be addressed without first proving
   * the domain is the caller's.
   */
  async requireActiveOwned(principal: Principal, domainId: string) {
    const domain = await this.get(principal, domainId);

    if (domain.status !== MailDomainStatus.ACTIVE) {
      throw new AppError(
        'CONFLICT',
        domain.status === MailDomainStatus.PENDING_VERIFICATION
          ? 'Verify the domain before adding mailboxes to it.'
          : 'That domain is suspended.',
      );
    }

    return domain;
  }

  /**
   * Removes a domain and everything on it.
   *
   * Requires the domain name typed back, because this deletes mailboxes and
   * their mail with no undo. A confirmation dialog is dismissed by reflex; the
   * name has to be read to be typed.
   */
  async remove(principal: Principal, id: string, confirmName: string) {
    const domain = await this.get(principal, id);

    if (normaliseAddress(confirmName) !== domain.name) {
      throw new AppError(
        'INVALID_REQUEST',
        'Type the domain name exactly to confirm. This deletes every mailbox on it.',
      );
    }

    // Recorded before the delete: afterwards the counts are gone, and "how many
    // mailboxes did that remove" is the first question asked.
    await this.activity.record(principal, {
      action: 'mail.domain.removed',
      customerId: domain.customerId,
      resourceType: 'mail_domain',
      resourceId: domain.id,
      oldValue: {
        name: domain.name,
        mailboxes: domain._count.mailboxes,
        aliases: domain._count.aliases,
      },
    });

    await this.prisma.mailDomain.delete({ where: { id: domain.id } });
    return { removed: true, mailboxes: domain._count.mailboxes };
  }

  /** What to publish, for the UI. Read-only, so it is safe to show any time. */
  challenge(domain: { name: string; verificationToken: string }) {
    return {
      host: `${VERIFICATION_HOST}.${domain.name}`,
      type: 'TXT',
      value: `${VERIFICATION_PREFIX}${domain.verificationToken}`,
    };
  }
}
