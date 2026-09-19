import { Injectable } from '@nestjs/common';
import { DnsRecordType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { AppError, invalidRequest, notFound } from '../common/errors';
import { validateAgainstZone, validateRecord, type DnsRecordInput } from './dns-validation';
import type { Principal } from '../common/principal';

/**
 * DNS records, for staff.
 *
 * Deliberately a separate service from `DnsService` rather than that one with a
 * flag. The customer path establishes ownership through `TenantScope` before it
 * reads anything, and the whole point of that is that it cannot be switched
 * off; a shared method taking "and also allow staff" is one wrong argument away
 * from a customer reading another customer's zone.
 *
 * The validation is the same because it is the same DNS. It lives in
 * `dns-validation.ts` and is called from both, rather than copied.
 */
@Injectable()
export class AdminDnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async list(domainId: string) {
    const domain = await this.prisma.domain.findUnique({
      where: { id: domainId },
      select: {
        id: true,
        name: true,
        dnsManaged: true,
        customerId: true,
        customer: { select: { fullName: true, companyName: true } },
      },
    });
    if (!domain) throw notFound('domain');

    const records = await this.prisma.dnsRecord.findMany({
      where: { domainId },
      orderBy: [{ name: 'asc' }, { type: 'asc' }],
    });

    return {
      domain: {
        id: domain.id,
        name: domain.name,
        dnsManaged: domain.dnsManaged,
        customerId: domain.customerId,
        customerName: domain.customer.companyName ?? domain.customer.fullName,
      },
      records,
    };
  }

  async create(principal: Principal, domainId: string, input: DnsRecordInput) {
    const domain = await this.prisma.domain.findUnique({
      where: { id: domainId },
      select: { id: true, name: true, customerId: true },
    });
    if (!domain) throw notFound('domain');

    const existing = await this.zoneRecords(domainId);
    this.assertValid(input, existing);

    const record = await this.prisma.dnsRecord.create({
      data: {
        domainId,
        type: input.type as DnsRecordType,
        name: input.name,
        value: input.value,
        ttl: input.ttl,
        priority: input.priority ?? null,
        weight: input.weight ?? null,
        port: input.port ?? null,
        // Not yet pushed. The panel and the provider are two different places,
        // and this column is what says which records have reached the second.
        providerSyncedAt: null,
      },
    });

    await this.activity.record(principal, {
      action: 'dns.record.created',
      customerId: domain.customerId,
      resourceType: 'dns_record',
      resourceId: record.id,
      visibility: 'CUSTOMER',
      newValue: { domain: domain.name, type: input.type, name: input.name, value: input.value },
    });

    return record;
  }

  async update(principal: Principal, recordId: string, input: DnsRecordInput) {
    const record = await this.prisma.dnsRecord.findUnique({
      where: { id: recordId },
      include: { domain: { select: { id: true, name: true, customerId: true } } },
    });
    if (!record) throw notFound('record');

    // The record being changed is excluded, or it conflicts with itself.
    const existing = (await this.zoneRecords(record.domainId)).filter((r) => r.id !== recordId);
    this.assertValid(input, existing);

    const updated = await this.prisma.dnsRecord.update({
      where: { id: recordId },
      data: {
        type: input.type as DnsRecordType,
        name: input.name,
        value: input.value,
        ttl: input.ttl,
        priority: input.priority ?? null,
        weight: input.weight ?? null,
        port: input.port ?? null,
        providerSyncedAt: null,
      },
    });

    await this.activity.record(principal, {
      action: 'dns.record.updated',
      customerId: record.domain.customerId,
      resourceType: 'dns_record',
      resourceId: recordId,
      visibility: 'CUSTOMER',
      oldValue: { type: record.type, name: record.name, value: record.value, ttl: record.ttl },
      newValue: { type: input.type, name: input.name, value: input.value, ttl: input.ttl },
    });

    return updated;
  }

  async remove(principal: Principal, recordId: string): Promise<void> {
    const record = await this.prisma.dnsRecord.findUnique({
      where: { id: recordId },
      include: { domain: { select: { name: true, customerId: true } } },
    });
    if (!record) throw notFound('record');

    await this.prisma.dnsRecord.delete({ where: { id: recordId } });

    await this.activity.record(principal, {
      action: 'dns.record.deleted',
      customerId: record.domain.customerId,
      resourceType: 'dns_record',
      resourceId: recordId,
      visibility: 'CUSTOMER',
      oldValue: {
        domain: record.domain.name,
        type: record.type,
        name: record.name,
        value: record.value,
      },
    });
  }

  private async zoneRecords(domainId: string): Promise<Array<DnsRecordInput & { id: string }>> {
    const records = await this.prisma.dnsRecord.findMany({ where: { domainId } });
    return records.map((record) => ({
      id: record.id,
      type: record.type,
      name: record.name,
      value: record.value,
      ttl: record.ttl,
      priority: record.priority ?? undefined,
      weight: record.weight ?? undefined,
      port: record.port ?? undefined,
    }));
  }

  /**
   * Twice: the record on its own, then against the rest of the zone.
   *
   * A record can be perfectly formed and still wrong here — a CNAME at the
   * apex, or one alongside an A record for the same name. Neither check finds
   * what the other does.
   */
  private assertValid(input: DnsRecordInput, existing: DnsRecordInput[]): void {
    const issues = [...validateRecord(input), ...validateAgainstZone(input, existing)];
    if (issues.length > 0) {
      throw new AppError('INVALID_REQUEST', issues[0]!.message, {
        fields: issues.map((issue) => ({ field: issue.field, message: issue.message })),
      });
    }
  }
}
