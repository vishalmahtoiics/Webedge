import { Injectable } from '@nestjs/common';
import { DnsRecordType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { TenantScope } from '../common/tenant-scope';
import { AppError, invalidRequest, notFound } from '../common/errors';
import {
  isManagedByWebEdge,
  validateAgainstZone,
  validateRecord,
  type DnsRecordInput,
} from './dns-validation';
import type { Principal } from '../common/principal';

/**
 * DNS records for a customer's domain.
 *
 * Ownership is established through TenantScope before anything else happens, so
 * a record id belonging to another customer is reported as not found rather than
 * forbidden. Every mutation is validated twice — once for the record on its own,
 * once against the rest of the zone — and audited.
 */
@Injectable()
export class DnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: TenantScope,
    private readonly activity: ActivityService,
  ) {}

  async list(principal: Principal, domainId: string) {
    const domain = await this.scope.findOwned<{ id: string; name: string; dnsManaged: boolean }>(
      principal,
      'domain',
      domainId,
      'domain',
    );

    const records = await this.prisma.dnsRecord.findMany({
      where: { domainId },
      orderBy: [{ name: 'asc' }, { type: 'asc' }],
    });

    return {
      domain: { id: domain.id, name: domain.name, dnsManaged: domain.dnsManaged },
      records,
    };
  }

  async create(principal: Principal, domainId: string, input: DnsRecordInput) {
    // Ownership first: never validate or touch a zone the caller does not own.
    await this.scope.findOwned(principal, 'domain', domainId, 'domain');

    const existing = await this.zoneRecords(domainId);
    this.assertValid(input, existing);

    const record = await this.prisma.dnsRecord.create({
      data: {
        domainId,
        type: input.type as DnsRecordType,
        name: input.name,
        value: input.value.trim(),
        ttl: input.ttl,
        priority: input.priority ?? null,
        weight: input.weight ?? null,
        port: input.port ?? null,
        managedByWebEdge: false,
      },
    });

    await this.activity.record(principal, {
      action: 'dns.record.created',
      resourceType: 'dns_record',
      resourceId: record.id,
      visibility: 'CUSTOMER',
      newValue: { type: input.type, name: input.name, value: input.value, ttl: input.ttl },
    });

    return record;
  }

  async update(principal: Principal, recordId: string, input: DnsRecordInput) {
    const record = await this.findOwnedRecord(principal, recordId);

    // The record being edited is excluded from the zone check, so it does not
    // report a conflict with itself.
    const existing = (await this.zoneRecords(record.domainId)).filter((r) => r.id !== recordId);
    this.assertValid(input, existing);

    const updated = await this.prisma.dnsRecord.update({
      where: { id: recordId },
      data: {
        type: input.type as DnsRecordType,
        name: input.name,
        value: input.value.trim(),
        ttl: input.ttl,
        priority: input.priority ?? null,
        weight: input.weight ?? null,
        port: input.port ?? null,
        // A record the customer edits is theirs now, whatever WebEdge set up.
        managedByWebEdge: false,
        providerSyncedAt: null,
      },
    });

    await this.activity.record(principal, {
      action: 'dns.record.updated',
      resourceType: 'dns_record',
      resourceId: recordId,
      visibility: 'CUSTOMER',
      oldValue: { type: record.type, name: record.name, value: record.value, ttl: record.ttl },
      newValue: { type: input.type, name: input.name, value: input.value, ttl: input.ttl },
    });

    return updated;
  }

  async remove(principal: Principal, recordId: string): Promise<void> {
    const record = await this.findOwnedRecord(principal, recordId);

    await this.prisma.dnsRecord.delete({ where: { id: recordId } });

    await this.activity.record(principal, {
      action: 'dns.record.deleted',
      resourceType: 'dns_record',
      resourceId: recordId,
      visibility: 'CUSTOMER',
      oldValue: { type: record.type, name: record.name, value: record.value },
    });
  }

  /**
   * Resolves a record through its domain, so tenancy is enforced by the domain's
   * ownership rather than by a filter on the record itself. A record id that
   * belongs to another customer is indistinguishable from one that does not
   * exist.
   */
  private async findOwnedRecord(principal: Principal, recordId: string) {
    const record = await this.prisma.dnsRecord.findUnique({ where: { id: recordId } });
    if (!record) throw notFound('DNS record');

    await this.scope.findOwned(principal, 'domain', record.domainId, 'DNS record');
    return record;
  }

  private async zoneRecords(domainId: string): Promise<Array<DnsRecordInput & { id: string }>> {
    const records = await this.prisma.dnsRecord.findMany({ where: { domainId } });
    return records.map((r) => ({
      id: r.id,
      type: r.type as DnsRecordInput['type'],
      name: r.name,
      value: r.value,
      ttl: r.ttl,
      priority: r.priority,
      weight: r.weight,
      port: r.port,
    }));
  }

  private assertValid(input: DnsRecordInput, existing: DnsRecordInput[]): void {
    const issues = [...validateRecord(input), ...validateAgainstZone(input, existing)];
    if (issues.length === 0) return;

    // Field-level detail so the form can mark the offending input rather than
    // showing one message above everything.
    throw new AppError('INVALID_REQUEST', issues[0]!.message, {
      fields: issues.reduce<Record<string, string>>((acc, issue) => {
        acc[issue.field] ??= issue.message;
        return acc;
      }, {}),
    });
  }

  /** Flags the records WebEdge relies on, used when seeding a zone. */
  static isManaged = isManagedByWebEdge;
}
