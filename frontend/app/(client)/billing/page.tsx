import { redirect } from 'next/navigation';
import { apiAuthed } from '@/lib/api';
import { PortalShell } from '@/components/portal-shell';
import { StatusBadge } from '@/components/status-badge';
import { formatCurrencyFromPaise } from '@/lib/format';

type Subscription = {
  id: string;
  status: string;
  renewsAt: string;
  autoRenew: boolean;
  cancelledAt: string | null;
  plan: {
    name: string;
    description: string | null;
    priceInPaise: number;
    billingCycle: string;
    maxWebsites: number | null;
    maxDomains: number | null;
    maxMailboxes: number | null;
    storageGb: number | null;
  };
};

const CYCLE: Record<string, string> = {
  MONTHLY: 'per month',
  QUARTERLY: 'per quarter',
  YEARLY: 'per year',
  BIENNIAL: 'per two years',
  TRIENNIAL: 'per three years',
};

type Invoice = {
  id: string;
  invoiceNumber: string | null;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  againstInvoiceNumber: string | null;
  status: string;
  totalInPaise: number;
  issuedAt: string | null;
  dueAt: string | null;
  voidReason: string | null;
};

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export default async function BillingPage() {
  const [result, current] = await Promise.all([
    apiAuthed<{ items: Invoice[]; total: number }>('customer', '/customer/invoices'),
    apiAuthed<{ subscription: Subscription | null }>('customer', '/customer/subscription'),
  ]);
  if (!result.ok && result.error.code === 'UNAUTHENTICATED') redirect('/login');

  const subscription = current.ok ? current.data.subscription : null;

  return (
    <PortalShell title="Billing" description="Your plan and invoices.">
      <section className="mb-8">
        <h2 className="text-base font-semibold">Your plan</h2>
        {!current.ok ? (
          <p className="mt-2 text-sm text-ink-muted">{current.error.message}</p>
        ) : !subscription ? (
          <p className="mt-2 text-sm text-ink-muted">
            {/* Stated as a fact, not as an error: having no plan is a state. */}
            No active plan. Talk to us about getting set up.
          </p>
        ) : (
          <div className="mt-2 rounded-xl border border-line bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 font-medium">
                  {subscription.plan.name}
                  <StatusBadge status={subscription.status} />
                </p>
                {subscription.plan.description ? (
                  <p className="mt-0.5 text-sm text-ink-muted">{subscription.plan.description}</p>
                ) : null}
              </div>
              <p className="tabular-nums">
                {formatCurrencyFromPaise(subscription.plan.priceInPaise)}
                <span className="ml-1.5 text-sm text-ink-muted">
                  {CYCLE[subscription.plan.billingCycle] ?? ''}
                </span>
              </p>
            </div>

            <p className="mt-3 text-sm text-ink-muted">
              {/* Cancelled means "runs until the period you paid for ends",
                  and the date is the first thing anyone asks for. */}
              {subscription.cancelledAt
                ? `Cancelled — your service runs until ${date(subscription.renewsAt)}.`
                : subscription.autoRenew
                  ? `Renews on ${date(subscription.renewsAt)}.`
                  : `Ends on ${date(subscription.renewsAt)}; auto-renew is off.`}
            </p>
          </div>
        )}
      </section>

      <h2 className="mb-2 text-base font-semibold">Invoices</h2>
      {!result.ok ? (
        <p className="text-sm text-ink-muted">{result.error.message}</p>
      ) : result.data.items.length === 0 ? (
        <div className="rounded-xl border border-line bg-white p-6">
          <h2 className="text-base font-semibold">No invoices yet</h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            Invoices appear here as soon as they are issued.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {result.data.items.map((invoice) => (
            <li
              key={invoice.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-medium">
                  <span className="font-mono text-sm">{invoice.invoiceNumber}</span>
                  <StatusBadge status={invoice.status} />
                </p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {/* Said plainly: a negative total with no label is the kind of
                      thing a customer has to ring support about. */}
                  {invoice.kind === 'CREDIT_NOTE'
                    ? `Credit note${invoice.againstInvoiceNumber ? ` against ${invoice.againstInvoiceNumber}` : ''} · `
                    : ''}
                  Issued {date(invoice.issuedAt)}
                  {invoice.dueAt && invoice.status !== 'PAID' ? ` · due ${date(invoice.dueAt)}` : ''}
                  {/* A cancelled invoice says why, so it does not read as a
                      document that changed for no reason. */}
                  {invoice.voidReason ? ` · cancelled: ${invoice.voidReason}` : ''}
                </p>
              </div>
              <p className="tabular-nums">{formatCurrencyFromPaise(invoice.totalInPaise)}</p>
            </li>
          ))}
        </ul>
      )}
    </PortalShell>
  );
}
