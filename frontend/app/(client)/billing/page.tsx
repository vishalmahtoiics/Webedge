import { redirect } from 'next/navigation';
import { apiAuthed } from '@/lib/api';
import { PortalShell } from '@/components/portal-shell';
import { StatusBadge } from '@/components/status-badge';
import { formatCurrencyFromPaise } from '@/lib/format';

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
  const result = await apiAuthed<{ items: Invoice[]; total: number }>('customer', '/customer/invoices');
  if (!result.ok && result.error.code === 'UNAUTHENTICATED') redirect('/login');

  return (
    <PortalShell title="Billing" description="Your invoices.">
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
