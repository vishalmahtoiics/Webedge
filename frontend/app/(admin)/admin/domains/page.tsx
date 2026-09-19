import { redirect } from 'next/navigation';
import Link from 'next/link';
import { apiAuthed } from '@/lib/api';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge } from '@/components/status-badge';

type DomainRow = {
  name: string;
  origin: 'sold' | 'on-account' | 'both';
  status: string | null;
  expiresAt: string | null;
  customer: { id: string; name: string } | null;
  account: { id: string; name: string } | null;
  dnsManaged: boolean;
  lastSeenAt: string | null;
};

/**
 * Every domain WebEdge knows about.
 *
 * Two sources, and the page says which each row came from: a domain sold to a
 * customer, or one found on the provider account and sold to nobody. Showing
 * them as one undifferentiated list would read as "our customers' domains" and
 * invite someone to act on a name no customer has been sold.
 *
 * Unassigned first, because that is the queue. A page that buries the work
 * under the settled rows is a page nobody uses to do the work.
 */

const ORIGIN_LABEL: Record<DomainRow['origin'], string> = {
  sold: 'Sold to a customer',
  'on-account': 'On the account, unassigned',
  both: 'Sold and live',
};

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

export default async function AdminDomainsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; owner?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.owner && params.owner !== 'all') query.set('owner', params.owner);
  query.set('take', '100');

  const result = await apiAuthed<{ total: number; items: DomainRow[] }>(
    'admin',
    `/admin/domains?${query.toString()}`,
  );
  if (!result.ok && result.error.code === 'UNAUTHENTICATED') redirect('/admin/login');

  const unassigned = result.ok ? result.data.items.filter((d) => d.customer === null).length : 0;

  return (
    <AdminShell
      title="Domains"
      description="Every domain WebEdge knows about — sold to a customer, or sitting on an upstream account."
    >
      {!result.ok ? (
        <p className="text-sm text-ink-muted">{result.error.message}</p>
      ) : (
        <div className="space-y-5">
          <form className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-4">
            <div>
              <label className="block text-sm font-medium" htmlFor="search">
                Search
              </label>
              <input
                id="search"
                name="search"
                defaultValue={params.search ?? ''}
                placeholder="Domain name"
                className="mt-1 rounded-lg border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium" htmlFor="owner">
                Owner
              </label>
              <select
                id="owner"
                name="owner"
                defaultValue={params.owner ?? 'all'}
                className="mt-1 rounded-lg border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none"
              >
                <option value="all">Any</option>
                <option value="unassigned">Unassigned</option>
                <option value="assigned">Assigned to a customer</option>
              </select>
            </div>
            <button
              type="submit"
              className="rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-ink"
            >
              Apply
            </button>
          </form>

          {result.data.items.length === 0 ? (
            <div className="rounded-xl border border-line bg-white p-6">
              <h2 className="text-base font-semibold">No domains</h2>
              <p className="mt-1.5 max-w-prose text-sm text-ink-muted">
                Nothing has been sold, and no sync has found any.{' '}
                <Link href="/admin/providers" className="underline">
                  Infrastructure
                </Link>{' '}
                is where an account is connected and synced.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-ink-muted">
                {result.data.total} {result.data.total === 1 ? 'domain' : 'domains'}
                {unassigned > 0 ? ` · ${unassigned} not yet assigned to a customer` : ''}
              </p>

              <ul className="divide-y divide-line rounded-xl border border-line bg-white">
                {result.data.items.map((domain) => (
                  <li
                    key={domain.name}
                    className="grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{domain.name}</span>
                        {domain.status ? <StatusBadge status={domain.status} /> : null}
                        {domain.dnsManaged ? (
                          <span className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-muted">
                            DNS here
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-sm text-ink-muted">
                        {/* Origin stated, never implied. A row with no customer
                            says so rather than leaving a blank that reads as
                            missing data. */}
                        {ORIGIN_LABEL[domain.origin]}
                        {domain.account ? ` · ${domain.account.name}` : ''}
                      </p>
                    </div>
                    <div className="text-sm sm:text-right">
                      {domain.customer ? (
                        <Link
                          href={`/admin/customers/${domain.customer.id}`}
                          className="underline"
                        >
                          {domain.customer.name}
                        </Link>
                      ) : (
                        <span className="text-state-warning">Unassigned</span>
                      )}
                      {/* An expiry with no source is left out entirely rather
                          than shown as a dash that reads like "never". */}
                      {when(domain.expiresAt) ? (
                        <p className="mt-0.5 text-ink-muted">Expires {when(domain.expiresAt)}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </AdminShell>
  );
}
