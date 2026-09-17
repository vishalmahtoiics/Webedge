import { redirect } from 'next/navigation';
import { apiAuthed, logout } from '@/lib/api';
import { getSession } from '@/lib/session';
import { UsageMeter } from '@/components/usage-meter';
import { AlertCard } from '@/components/alert-card';
import { formatRelative } from '@/lib/format';

type Metric =
  | { available: true; value: number; unit: string; syncedAt: string | null; limit?: number | null }
  | { available: false; reason: string; limit?: number | null };

type Dashboard = {
  syncedAt: string | null;
  website: { id: string; domain: string; status: string; createdAt: string; phpVersion: string | null } | null;
  usage: Record<string, Metric>;
  plan: {
    name: string;
    renewsAt: string | null;
    autoRenew: boolean;
    limits: Record<string, number | null>;
  } | null;
  alerts: Array<{
    severity: 'critical' | 'warning' | 'info';
    title: string;
    description: string;
    action?: { label: string; href: string };
  }>;
  domainsSummary: { total: number; expiringSoon: number };
  activity: Array<{ id: string; action: string; resourceType: string | null; createdAt: string }>;
  unreadNotifications: number;
};

/** Audit actions are machine keys; the customer sees plain language. */
const ACTION_LABELS: Record<string, string> = {
  'auth.customer.signed_in': 'Signed in',
  'dns.record.updated': 'DNS record updated',
  'files.deleted': 'File deleted',
  'admin.customer.plan_assigned': 'Plan updated',
  'admin.customer.status_changed': 'Account status changed',
};

export default async function CustomerDashboard() {
  const { accessToken, refreshToken } = await getSession('customer');
  if (!accessToken && !refreshToken) redirect('/login');

  const result = await apiAuthed<Dashboard>('customer', '/customer/dashboard');
  if (!result.ok && result.error.code === 'UNAUTHENTICATED') redirect('/login');

  async function signOut() {
    'use server';
    await logout('customer');
    redirect('/login');
  }

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between border-b border-line bg-white px-5">
        <div className="flex items-center gap-2.5">
          <span className="h-4 w-0.5 rounded-sm bg-primary" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">WebEdge Solution</span>
        </div>
        <form action={signOut}>
          <button type="submit" className="text-sm text-ink-muted hover:text-ink">
            Sign out
          </button>
        </form>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          {result.ok && result.data.syncedAt ? (
            <span className="text-xs text-ink-subtle">
              Updated {formatRelative(result.data.syncedAt)}
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 text-sm text-ink-muted">
          Manage your websites, domains, email and hosting resources from one place.
        </p>

        {!result.ok ? (
          <div className="mt-8 rounded-xl border border-line bg-white p-6">
            <h2 className="text-base font-semibold">We couldn&rsquo;t load your dashboard</h2>
            <p className="mt-1.5 max-w-prose text-sm text-ink-muted">{result.error.message}</p>
          </div>
        ) : (
          <DashboardBody data={result.data} />
        )}
      </main>
    </div>
  );
}

function DashboardBody({ data }: { data: Dashboard }) {
  return (
    <div className="mt-8 flex flex-col gap-5">
      {data.website ? (
        <section className="rounded-xl border border-line bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">{data.website.domain}</h2>
                <StatusPill status={data.website.status} />
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                Created {new Date(data.website.createdAt).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
                {data.website.phpVersion ? ` · PHP ${data.website.phpVersion}` : ''}
              </p>
            </div>
            <a
              href={`https://${data.website.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-line-input px-3 py-1.5 text-sm hover:border-line-strong"
            >
              Open website ↗
            </a>
          </div>
        </section>
      ) : null}

      {data.alerts.map((alert) => (
        <AlertCard key={alert.title} {...alert} />
      ))}

      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-xl border border-line bg-white p-5">
          <h2 className="text-sm font-semibold">Resource usage</h2>
          <div className="mt-4 flex flex-col gap-4">
            {Object.entries(data.usage).map(([key, metric]) => (
              <UsageMeter key={key} name={key} metric={metric} />
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-line bg-white p-5">
          <h2 className="text-sm font-semibold">Plan</h2>
          {data.plan ? (
            <div className="mt-3">
              <p className="text-lg font-semibold tracking-tight">{data.plan.name}</p>
              {data.plan.renewsAt ? (
                <p className="mt-1 text-sm text-ink-muted">
                  Renews{' '}
                  {new Date(data.plan.renewsAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                  {data.plan.autoRenew ? '' : ' · auto-renew off'}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">No active plan.</p>
          )}

          <h3 className="mt-5 text-sm font-semibold">Domains</h3>
          <p className="mt-1 text-sm text-ink-muted">
            {data.domainsSummary.total} domain{data.domainsSummary.total === 1 ? '' : 's'}
            {data.domainsSummary.expiringSoon > 0
              ? ` · ${data.domainsSummary.expiringSoon} expiring within 30 days`
              : ''}
          </p>
        </section>
      </div>

      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-sm font-semibold">Recent activity</h2>
        {data.activity.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">Nothing yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-line">
            {data.activity.map((entry) => (
              <li key={entry.id} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                <span>{ACTION_LABELS[entry.action] ?? entry.action}</span>
                <span className="shrink-0 text-xs text-ink-subtle">
                  {formatRelative(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Status is never colour alone — the dot is always paired with its label. */
function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'ACTIVE'
      ? 'text-state-success'
      : status === 'SUSPENDED' || status === 'FAILED'
        ? 'text-state-danger'
        : 'text-state-warning';

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${tone}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
