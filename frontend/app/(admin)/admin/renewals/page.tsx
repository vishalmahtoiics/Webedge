import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiAuthed } from '@/lib/api';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge } from '@/components/status-badge';
import { RunSweepButton } from '@/components/run-sweep-button';
import { formatCurrencyFromPaise, formatRelative } from '@/lib/format';

type DueRenewal = {
  id: string;
  customerId: string;
  customerName: string;
  renewsAt: string;
  status: string;
  planName: string;
  priceInPaise: number;
};

/**
 * What the renewal sweep is about to charge, and to whom.
 *
 * A billing process nobody can look at is one nobody trusts, and the first
 * question about an automatic charge is always "what is it going to do before
 * it does it". This page answers that from the same query the sweep itself
 * runs, so what is listed here is what will be billed — not a separate
 * calculation that can drift from it.
 */
export default async function AdminRenewalsPage() {
  const result = await apiAuthed<{ before: string; items: DueRenewal[] }>(
    'admin',
    '/admin/renewals/due?limit=100',
  );
  if (!result.ok && result.error.code === 'UNAUTHENTICATED') redirect('/admin/login');

  /**
   * Runs the sweep now.
   *
   * Safe to press twice, and safe to press while the timer fires: every step is
   * either a compare-and-swap or covered by the unique index on
   * `(subscriptionId, periodStart)`. That is a property of the sweep rather
   * than of this button, which is why there is no guard here.
   */
  async function runSweep() {
    'use server';
    await apiAuthed('admin', '/admin/renewals/run', { method: 'POST' });
    revalidatePath('/admin/renewals');
  }

  const items = result.ok ? result.data.items : [];
  const total = items.reduce((sum, item) => sum + item.priceInPaise, 0);

  return (
    <AdminShell
      title="Renewals"
      description="Subscriptions due to be invoiced, and the sweep that invoices them."
    >
      {!result.ok ? (
        <p className="text-sm text-ink-muted">{result.error.message}</p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-white p-5">
            <div>
              <h2 className="text-base font-semibold">
                {items.length === 0
                  ? 'Nothing due'
                  : `${items.length} subscription${items.length === 1 ? '' : 's'} due`}
              </h2>
              <p className="mt-1.5 text-sm text-ink-muted">
                {items.length === 0
                  ? 'The sweep runs on its own schedule. There is nothing for it to invoice right now.'
                  : /* Before tax: the invoice applies GST per line, and the rate
                       depends on where the customer is. Showing a tax-inclusive
                       figure here would be a second calculation that can
                       disagree with the invoice. */
                    `${formatCurrencyFromPaise(total)} before tax.`}
              </p>
            </div>
            <RunSweepButton action={runSweep} dueCount={items.length} />
          </div>

          {items.length > 0 && (
            <ul className="divide-y divide-line rounded-xl border border-line bg-white">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div>
                    <p className="text-sm font-medium">{item.customerName}</p>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {item.planName} · due {formatRelative(item.renewsAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 sm:justify-end">
                    <StatusBadge status={item.status} />
                    <span className="text-sm tabular-nums">
                      {formatCurrencyFromPaise(item.priceInPaise)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="text-sm text-ink-muted">
            A renewal raises an invoice and marks it due. Nothing here collects payment or marks an
            invoice paid.
          </p>
        </div>
      )}
    </AdminShell>
  );
}
