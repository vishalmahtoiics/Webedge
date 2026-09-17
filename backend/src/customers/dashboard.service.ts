import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveCapability, type ProductFamily } from '../providers/capabilities';
import type { CustomerPrincipal } from '../common/principal';

/**
 * The customer dashboard, assembled from local state in one aggregated call.
 *
 * Page loads never fan out into provider calls: workers keep local state in sync
 * and the dashboard reads that, so a slow or unavailable provider shows stale
 * data with its age rather than a spinner or an error.
 *
 * Nothing here is invented. A figure with no real source is reported as
 * unavailable with the reason, never as zero or a placeholder — a confident
 * "0 GB used" is worse than "Not available", because the customer believes it.
 */

export type MetricValue =
  | { available: true; value: number; unit: string; syncedAt: Date | null }
  | { available: false; reason: string };

export type DashboardAlert = {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  action?: { label: string; href: string };
};

const unavailable = (reason: string): MetricValue => ({ available: false, reason });

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async build(principal: CustomerPrincipal) {
    const { customerId } = principal;

    const [websites, domains, subscription, recentActivity, unreadNotifications] = await Promise.all([
      this.prisma.website.findMany({
        where: { customerId },
        orderBy: { createdAt: 'asc' },
        include: { hostingAccount: { select: { productFamily: true } } },
      }),
      this.prisma.domain.findMany({ where: { customerId }, orderBy: { expiresAt: 'asc' } }),
      this.prisma.subscription.findFirst({
        where: { customerId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        include: { plan: true },
      }),
      this.prisma.activityLog.findMany({
        where: { customerId, visibility: 'CUSTOMER' },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, action: true, resourceType: true, createdAt: true },
      }),
      this.prisma.notification.count({ where: { customerId, readAt: null } }),
    ]);

    const plan = subscription?.plan ?? null;
    const primary = websites[0] ?? null;
    const family = (primary?.hostingAccount?.productFamily ?? 'unknown') as ProductFamily;

    return {
      // Everything on this page came from local state as of this moment. The UI
      // shows the age so "4 minutes ago" is visible rather than implied.
      syncedAt: primary?.lastSyncedAt ?? null,

      website: primary
        ? {
            id: primary.id,
            domain: primary.domain,
            status: primary.status,
            createdAt: primary.createdAt,
            phpVersion: primary.phpVersion,
          }
        : null,

      usage: this.usage(websites, domains.length, plan, family),
      plan: plan
        ? {
            name: plan.name,
            renewsAt: subscription?.renewsAt ?? null,
            autoRenew: subscription?.autoRenew ?? false,
            limits: {
              websites: plan.maxWebsites,
              domains: plan.maxDomains,
              databases: plan.maxDatabases,
              mailboxes: plan.maxMailboxes,
              storageGb: plan.storageGb,
            },
          }
        : null,

      alerts: this.alerts(websites.length, domains, subscription),

      domainsSummary: {
        total: domains.length,
        expiringSoon: domains.filter((d) => this.daysUntil(d.expiresAt) !== null && this.daysUntil(d.expiresAt)! <= 30)
          .length,
      },

      activity: recentActivity,
      unreadNotifications,
    };
  }

  private usage(
    websites: Array<{ diskUsedBytes: bigint | null; lastSyncedAt: Date | null }>,
    domainCount: number,
    plan: { maxWebsites: number | null; maxDomains: number | null; storageGb: number | null } | null,
    family: ProductFamily,
  ): Record<string, MetricValue & { limit?: number | null }> {
    // Counts are WebEdge's own data, so they are always real.
    const counts = {
      websites: {
        available: true as const,
        value: websites.length,
        unit: 'count',
        syncedAt: null,
        limit: plan?.maxWebsites ?? null,
      },
      domains: {
        available: true as const,
        value: domainCount,
        unit: 'count',
        syncedAt: null,
        limit: plan?.maxDomains ?? null,
      },
    };

    // Storage depends entirely on what the provider family exposes. On Agency
    // Hosting disk metrics exist only at order level, so there is no honest
    // per-website figure to show.
    const perWebsiteDisk = resolveCapability(family, 'metrics.diskPerWebsite');
    if (!perWebsiteDisk.available) {
      return {
        ...counts,
        storage: {
          ...unavailable(
            family === 'unknown'
              ? 'Storage usage is not available yet.'
              : 'Storage usage is reported for your plan rather than per website.',
          ),
          limit: plan?.storageGb ?? null,
        },
      };
    }

    const synced = websites.filter((w) => w.diskUsedBytes !== null);
    if (synced.length === 0) {
      return { ...counts, storage: { ...unavailable('Storage usage has not been measured yet.') } };
    }

    const totalBytes = synced.reduce((sum, w) => sum + Number(w.diskUsedBytes ?? 0n), 0);
    return {
      ...counts,
      storage: {
        available: true,
        value: Number((totalBytes / 1024 ** 3).toFixed(1)),
        unit: 'GB',
        syncedAt: synced[0]?.lastSyncedAt ?? null,
        limit: plan?.storageGb ?? null,
      },
    };
  }

  /** Only conditions that are actually true of this account's data. */
  private alerts(
    websiteCount: number,
    domains: Array<{ name: string; expiresAt: Date | null; autoRenew: boolean }>,
    subscription: { renewsAt: Date; autoRenew: boolean } | null,
  ): DashboardAlert[] {
    const alerts: DashboardAlert[] = [];

    for (const domain of domains) {
      const days = this.daysUntil(domain.expiresAt);
      if (days === null) continue;

      if (days < 0) {
        alerts.push({
          severity: 'critical',
          title: `${domain.name} has expired`,
          description: 'Renew it now to avoid losing the domain.',
          action: { label: 'Renew domain', href: '/domains' },
        });
      } else if (days <= 30 && !domain.autoRenew) {
        alerts.push({
          severity: 'warning',
          title: `${domain.name} expires in ${days} day${days === 1 ? '' : 's'}`,
          description: 'Auto-renew is off, so this domain will not renew by itself.',
          action: { label: 'Turn on auto-renew', href: '/domains' },
        });
      }
    }

    const renewalDays = this.daysUntil(subscription?.renewsAt ?? null);
    if (renewalDays !== null && renewalDays <= 7 && !subscription?.autoRenew) {
      alerts.push({
        severity: 'warning',
        title: `Your plan renews in ${renewalDays} day${renewalDays === 1 ? '' : 's'}`,
        description: 'Auto-renew is off. Renew to keep your services running.',
        action: { label: 'Renew now', href: '/billing' },
      });
    }

    if (websiteCount === 0) {
      alerts.push({
        severity: 'info',
        title: 'No websites yet',
        description: 'Add your first website to manage hosting, files and email in one place.',
        action: { label: 'Add website', href: '/websites' },
      });
    }

    // Most severe first, and capped: a wall of alerts is a wall of noise.
    const order = { critical: 0, warning: 1, info: 2 };
    return alerts.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 3);
  }

  private daysUntil(date: Date | null): number | null {
    if (!date) return null;
    return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  }
}
