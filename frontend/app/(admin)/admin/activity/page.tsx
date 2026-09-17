import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiAuthed } from '@/lib/api';
import { AdminShell } from '@/components/admin-shell';
import { ActivityList, type ActivityEntry } from '@/components/activity-list';

/**
 * The staff trail.
 *
 * The security trail is a separate page behind its own permission rather than a
 * filter on this one: a page that silently omits rows the viewer cannot see
 * looks complete when it is not.
 */
export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; customerId?: string; security?: string }>;
}) {
  const { action, customerId, security } = await searchParams;
  const securityTrail = security === '1';

  const query = new URLSearchParams();
  if (action) query.set('action', action);
  if (customerId) query.set('customerId', customerId);

  const result = await apiAuthed<{ items: ActivityEntry[]; total: number }>(
    'admin',
    `/admin/activity${securityTrail ? '/security' : ''}${query.size ? `?${query}` : ''}`,
  );
  if (!result.ok && result.error.code === 'UNAUTHENTICATED') redirect('/admin/login');

  const here = (next: boolean) => {
    const params = new URLSearchParams(query);
    if (next) params.set('security', '1');
    return `/admin/activity${params.size ? `?${params}` : ''}`;
  };

  return (
    <AdminShell
      title="Activity"
      description={
        securityTrail
          ? 'Sign-ins, credentials, roles and impersonation.'
          : 'What happened, who did it and when.'
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <nav className="flex gap-1 rounded-lg border border-line bg-white p-1" aria-label="Trail">
          <Link
            href={here(false)}
            aria-current={securityTrail ? undefined : 'page'}
            className={`rounded-md px-3 py-1.5 text-sm ${
              securityTrail ? 'text-ink-muted hover:text-ink' : 'bg-primary-soft font-medium text-primary'
            }`}
          >
            All activity
          </Link>
          <Link
            href={here(true)}
            aria-current={securityTrail ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 text-sm ${
              securityTrail ? 'bg-primary-soft font-medium text-primary' : 'text-ink-muted hover:text-ink'
            }`}
          >
            Security
          </Link>
        </nav>

        <form className="flex flex-wrap items-end gap-3" action="/admin/activity">
          {securityTrail ? <input type="hidden" name="security" value="1" /> : null}
          {customerId ? <input type="hidden" name="customerId" value={customerId} /> : null}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Action contains</span>
            <input
              type="search"
              name="action"
              defaultValue={action ?? ''}
              placeholder="dns, invoice, files"
              className="w-56 rounded-lg border border-line-input px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
          >
            Apply
          </button>
        </form>
      </div>

      <div className="mt-6">
        {!result.ok ? (
          <p className="text-sm text-ink-muted">
            {/* A missing permission is stated plainly rather than shown as an
                empty trail, which would read as "nothing happened". */}
            {result.error.code === 'PERMISSION_DENIED'
              ? 'Your role does not include the security trail.'
              : result.error.message}
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-muted">
              {result.data.total} entr{result.data.total === 1 ? 'y' : 'ies'}
              {customerId ? ' for this customer' : ''}.
            </p>
            <ActivityList items={result.data.items} />
          </>
        )}
      </div>
    </AdminShell>
  );
}
