import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { apiAuthed } from '@/lib/api';
import { AdminShell } from '@/components/admin-shell';
import { AlertCard } from '@/components/alert-card';

type ProviderAccount = {
  id: string;
  accountName: string;
  status: string;
  lastError: string | null;
  credentials: Array<{ id: string; revokedAt: string | null }>;
};

type SequenceAudit = { financialYear: string; missing: number[]; duplicates: string[] };

/**
 * Every number on this page comes from a count the API actually returns. Where
 * there is no source, the card says so — a plausible-looking zero is worse than
 * an honest gap, because nobody goes looking for the cause of a zero.
 */
function Stat({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-line bg-white p-5 hover:border-line-strong"
    >
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </Link>
  );
}

export default async function AdminDashboard() {
  const { accessToken, refreshToken } = await getSession('admin');
  if (!accessToken && !refreshToken) redirect('/admin/login');

  const [customers, providers, audit] = await Promise.all([
    // take=1 because only the total is wanted here; the list has its own page.
    apiAuthed<{ total: number }>('admin', '/admin/customers?take=1'),
    apiAuthed<ProviderAccount[]>('admin', '/admin/providers'),
    apiAuthed<SequenceAudit>('admin', '/admin/billing/sequence'),
  ]);

  if (!customers.ok && customers.error.code === 'UNAUTHENTICATED') redirect('/admin/login');

  const unhealthy = providers.ok
    ? providers.data.filter(
        (a) =>
          a.status !== 'ACTIVE' ||
          a.lastError !== null ||
          a.credentials.every((c) => c.revokedAt !== null),
      )
    : [];

  const sequenceBroken =
    audit.ok && (audit.data.missing.length > 0 || audit.data.duplicates.length > 0);

  return (
    <AdminShell title="Overview" description="Customers, infrastructure and billing health.">
      <div className="flex flex-col gap-4">
        {sequenceBroken ? (
          <AlertCard
            severity="critical"
            title={`The ${audit.data.financialYear} invoice sequence has a gap`}
            description="A missing or duplicated serial number is an audit finding. Open billing to see which."
            action={{ label: 'Open billing', href: '/admin/billing' }}
          />
        ) : null}

        {unhealthy.map((account) => (
          <AlertCard
            key={account.id}
            severity="warning"
            title={`${account.accountName} needs attention`}
            description={
              account.lastError ??
              (account.status !== 'ACTIVE'
                ? `The account is ${account.status.toLowerCase()}.`
                : 'It has no active credential, so nothing on it can be provisioned.')
            }
            action={{ label: 'Open infrastructure', href: '/admin/providers' }}
          />
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Customers"
          value={customers.ok ? String(customers.data.total) : 'Not available'}
          href="/admin/customers"
        />
        <Stat
          label="Provider accounts"
          value={providers.ok ? String(providers.data.length) : 'Not available'}
          href="/admin/providers"
        />
        <Stat
          label="Invoice sequence"
          value={audit.ok ? (sequenceBroken ? 'Gap found' : 'Intact') : 'Not available'}
          href="/admin/billing"
        />
      </div>

      {/*
        Named rather than left as an empty screen to discover. Each of these is
        blocked on something outside the code — an account, a merchant
        activation, or mail infrastructure — and a card that looks broken is
        worse than one that says why it is not there.
      */}
      <section className="mt-8 rounded-xl border border-line bg-white p-5">
        <h2 className="text-base font-semibold">Not built yet</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm text-ink-muted">
          <li>
            <span className="font-medium text-ink">Databases, backups and WordPress</span> — waiting on a
            staging provider account. Nothing can be verified against the real API without one.
          </li>
          <li>
            <span className="font-medium text-ink">Mailboxes</span> — waiting on the mail servers. WebEdge
            runs its own rather than reselling the provider&apos;s.
          </li>
          <li>
            <span className="font-medium text-ink">Payments</span> — waiting on merchant activation.
            Invoices are issued and numbered; nothing collects on them yet.
          </li>
        </ul>
      </section>
    </AdminShell>
  );
}
