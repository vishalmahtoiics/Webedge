import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiAuthed } from '@/lib/api';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge } from '@/components/status-badge';

type CustomerListItem = {
  id: string;
  fullName: string;
  companyName: string | null;
  email: string;
  status: string;
  createdAt: string;
  websiteCount: number;
  domainCount: number;
  activePlan: string | null;
};

const STATUSES = ['ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED', 'TERMINATED'];

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const { search, status } = await searchParams;

  // Built here rather than passing searchParams through: only the two keys the
  // API understands are forwarded, so a crafted query string cannot reach it.
  const query = new URLSearchParams();
  if (search) query.set('search', search);
  if (status && STATUSES.includes(status)) query.set('status', status);

  const result = await apiAuthed<{ items: CustomerListItem[]; total: number }>(
    'admin',
    `/admin/customers${query.size ? `?${query}` : ''}`,
  );
  if (!result.ok && result.error.code === 'UNAUTHENTICATED') redirect('/admin/login');

  return (
    <AdminShell
      title="Customers"
      description={result.ok ? `${result.data.total} account${result.data.total === 1 ? '' : 's'}.` : undefined}
    >
      <form className="flex flex-wrap items-end gap-3" action="/admin/customers">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Search</span>
          <input
            type="search"
            name="search"
            defaultValue={search ?? ''}
            placeholder="Name, email or GSTIN"
            className="w-64 rounded-lg border border-line-input px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Status</span>
          <select
            name="status"
            defaultValue={status ?? ''}
            className="rounded-lg border border-line-input px-3 py-2 text-sm"
          >
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ').toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
        >
          Apply
        </button>
      </form>

      <div className="mt-6">
        {!result.ok ? (
          <p className="text-sm text-ink-muted">{result.error.message}</p>
        ) : result.data.items.length === 0 ? (
          <div className="rounded-xl border border-line bg-white p-6">
            <h2 className="text-base font-semibold">No customers match</h2>
            <p className="mt-1.5 text-sm text-ink-muted">
              {search || status ? 'Try a broader search.' : 'Customers you create will appear here.'}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {result.data.items.map((customer) => (
              <li key={customer.id}>
                <Link
                  href={`/admin/customers/${customer.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4 hover:border-line-strong"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      {customer.companyName ?? customer.fullName}
                      <StatusBadge status={customer.status} />
                    </p>
                    <p className="mt-0.5 truncate text-sm text-ink-muted">{customer.email}</p>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {customer.websiteCount} website{customer.websiteCount === 1 ? '' : 's'} ·{' '}
                    {customer.domainCount} domain{customer.domainCount === 1 ? '' : 's'} ·{' '}
                    {/* No plan is stated as no plan, never as a dash that could
                        read as missing data. */}
                    {customer.activePlan ?? 'no active plan'}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminShell>
  );
}
