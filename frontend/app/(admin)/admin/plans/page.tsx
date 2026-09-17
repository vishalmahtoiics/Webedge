import { redirect } from 'next/navigation';
import { apiAuthed } from '@/lib/api';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge } from '@/components/status-badge';
import { formatCurrencyFromPaise } from '@/lib/format';

type Plan = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  priceInPaise: number;
  billingCycle: string;
  isPublic: boolean;
  isActive: boolean;
  maxWebsites: number | null;
  maxDomains: number | null;
  maxDatabases: number | null;
  maxMailboxes: number | null;
  storageGb: number | null;
  mailboxQuotaGb: number | null;
  providerProduct: string | null;
  _count: { subscriptions: number };
};

const CYCLE: Record<string, string> = {
  MONTHLY: 'per month',
  QUARTERLY: 'per quarter',
  YEARLY: 'per year',
  BIENNIAL: 'per two years',
  TRIENNIAL: 'per three years',
};

/**
 * Null is unlimited, and says so. A dash would read as missing data.
 *
 * The plural is given rather than derived by adding an "s", which produces
 * "mailboxs". Passing both forms avoids the whole class instead of special-casing
 * the one word that broke.
 */
const limit = (value: number | null, singular: string, plural: string) =>
  value === null ? `Unlimited ${plural}` : `${value} ${value === 1 ? singular : plural}`;

export default async function AdminPlansPage() {
  const result = await apiAuthed<{ items: Plan[]; total: number }>(
    'admin',
    '/admin/plans?includeInactive=true',
  );
  if (!result.ok && result.error.code === 'UNAUTHENTICATED') redirect('/admin/login');

  return (
    <AdminShell
      title="Plans"
      description="What is on sale, at what price, with what limits."
    >
      {!result.ok ? (
        <p className="text-sm text-ink-muted">{result.error.message}</p>
      ) : result.data.items.length === 0 ? (
        <div className="rounded-xl border border-line bg-white p-6">
          <h2 className="text-base font-semibold">No plans yet</h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            Run the seed for the starting catalogue, or create one.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-3">
          {result.data.items.map((plan) => (
            <li
              key={plan.id}
              className={`rounded-xl border bg-white p-5 ${
                plan.isActive ? 'border-line' : 'border-line-strong bg-canvas'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{plan.name}</h2>
                  <p className="mt-0.5 font-mono text-xs text-ink-subtle">{plan.slug}</p>
                </div>
                {/* A withdrawn plan is still listed for staff, because customers
                    remain on it and its invoices cite it. */}
                <StatusBadge status={plan.isActive ? 'ACTIVE' : 'WITHDRAWN'} />
              </div>

              <p className="mt-3 text-xl font-semibold tabular-nums">
                {formatCurrencyFromPaise(plan.priceInPaise)}
                <span className="ml-1.5 text-sm font-normal text-ink-muted">
                  {CYCLE[plan.billingCycle] ?? plan.billingCycle.toLowerCase()}
                </span>
              </p>

              {plan.description ? (
                <p className="mt-2 text-sm text-ink-muted">{plan.description}</p>
              ) : null}

              <ul className="mt-4 flex flex-col gap-1 text-sm text-ink-muted">
                <li>{limit(plan.maxWebsites, 'website', 'websites')}</li>
                <li>{limit(plan.maxDomains, 'domain', 'domains')}</li>
                <li>{limit(plan.maxDatabases, 'database', 'databases')}</li>
                <li>{limit(plan.maxMailboxes, 'mailbox', 'mailboxes')}</li>
                <li>
                  {plan.storageGb === null ? 'Unlimited storage' : `${plan.storageGb} GB storage`}
                </li>
              </ul>

              <dl className="mt-4 border-t border-line pt-3 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-muted">On this plan</dt>
                  <dd className="tabular-nums">{plan._count.subscriptions}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-muted">Listed publicly</dt>
                  <dd>{plan.isPublic ? 'Yes' : 'No'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  {/* Staff-only, and never sent to a customer: naming the
                      upstream product names the provider. */}
                  <dt className="text-ink-muted">Fulfilled by</dt>
                  <dd>{plan.providerProduct ?? 'Not set'}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 max-w-prose text-sm text-ink-muted">
        A plan is never deleted. Withdrawing it stops new sales and leaves existing customers on
        what they bought — subscriptions and issued invoices both cite the plan they were sold.
      </p>
    </AdminShell>
  );
}
