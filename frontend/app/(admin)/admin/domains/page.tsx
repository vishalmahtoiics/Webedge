import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { apiAuthed } from '@/lib/api';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge } from '@/components/status-badge';
import { AddDomainForm, AssignDomainButton } from '@/components/domain-forms';

type DomainRow = {
  name: string;
  domainId: string | null;
  discoveredId: string | null;
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

/**
 * Where WebEdge learnt about this domain.
 *
 * Stated on every row rather than implied. "Added by hand" and "found on the
 * provider" behave differently — one can be assigned, the other cannot — and a
 * page that does not say which invites someone to look for a control that is
 * not there.
 */
const ORIGIN: Record<DomainRow['origin'], { label: string; tone: string }> = {
  sold: { label: 'Added by hand', tone: 'border-line text-ink-muted' },
  'on-account': { label: 'From the provider', tone: 'border-primary/30 bg-primary-soft text-primary' },
  both: { label: 'From the provider · assigned', tone: 'border-primary/30 bg-primary-soft text-primary' },
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

  const [result, customerList] = await Promise.all([
    apiAuthed<{ total: number; items: DomainRow[] }>('admin', `/admin/domains?${query.toString()}`),
    apiAuthed<{ items: Array<{ id: string; fullName: string; companyName: string | null }> }>(
      'admin',
      '/admin/customers?take=100',
    ),
  ]);
  if (!result.ok && result.error.code === 'UNAUTHENTICATED') redirect('/admin/login');

  const customers = customerList.ok
    ? customerList.data.items.map((c) => ({ id: c.id, name: c.companyName ?? c.fullName }))
    : [];

  async function assignDomain(discoveredId: string, customerId: string) {
    'use server';
    const done = await apiAuthed('admin', '/admin/domains/claim', {
      method: 'POST',
      body: { discoveredId, customerId },
    });
    if (!done.ok) return { ok: false as const, message: done.error.message };
    revalidatePath('/admin/domains');
    return { ok: true as const };
  }

  async function addDomain(input: {
    name: string;
    customerId: string;
    expiresAt?: string;
    registrar?: string;
    dnsManaged?: boolean;
  }) {
    'use server';
    const done = await apiAuthed('admin', '/admin/domains', {
      method: 'POST',
      body: {
        ...input,
        // A date input gives YYYY-MM-DD; the API wants a timestamp.
        expiresAt: input.expiresAt ? `${input.expiresAt}T00:00:00.000Z` : undefined,
      },
    });
    if (!done.ok) return { ok: false as const, message: done.error.message };
    revalidatePath('/admin/domains');
    return { ok: true as const };
  }

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
              className="tap ring-focus rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-ink"
            >
              Apply
            </button>
          </form>

          <AddDomainForm customers={customers} action={addDomain} />

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

              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
                {result.data.items.map((domain, index) => (
                  <li
                    key={domain.name}
                    className="enter lift grid gap-2 border-l-2 border-l-transparent p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                    // Staggered, and capped: past a handful the delay stops
                    // reading as arrival and starts reading as lag.
                    style={{ animationDelay: `${Math.min(index, 8) * 24}ms` }}
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{domain.name}</span>
                        {domain.status ? <StatusBadge status={domain.status} /> : null}
                        {/* Where it came from, on the row, not in a legend. */}
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${ORIGIN[domain.origin].tone}`}
                        >
                          {ORIGIN[domain.origin].label}
                        </span>
                        {domain.dnsManaged ? (
                          <span className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted">
                            DNS here
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-sm text-ink-muted">
                        {domain.account ? domain.account.name : 'Not on a connected account'}
                        {when(domain.expiresAt) ? ` · expires ${when(domain.expiresAt)}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 text-sm sm:justify-end">
                      {/* DNS only once a domain has an owner: the records
                          belong to a tenant, and there is none until then. */}
                      {domain.domainId ? (
                        <Link
                          href={`/admin/domains/${domain.domainId}`}
                          className="tap ring-focus rounded-lg border border-line px-2.5 py-1 text-xs font-medium hover:border-ink"
                        >
                          DNS
                        </Link>
                      ) : null}
                      {domain.customer ? (
                        <Link
                          href={`/admin/customers/${domain.customer.id}`}
                          className="tap ring-focus rounded underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                        >
                          {domain.customer.name}
                        </Link>
                      ) : domain.discoveredId ? (
                        <AssignDomainButton
                          discoveredId={domain.discoveredId}
                          domainName={domain.name}
                          customers={customers}
                          action={assignDomain}
                        />
                      ) : (
                        <span className="text-state-warning">Unassigned</span>
                      )}
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
