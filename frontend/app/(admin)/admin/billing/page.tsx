import { redirect } from 'next/navigation';
import { apiAuthed } from '@/lib/api';
import { AdminShell } from '@/components/admin-shell';
import { AlertCard } from '@/components/alert-card';
import { StatusBadge } from '@/components/status-badge';
import { formatCurrencyFromPaise } from '@/lib/format';

type Invoice = {
  id: string;
  invoiceNumber: string | null;
  financialYear: string | null;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  againstInvoiceNumber: string | null;
  status: string;
  customerName: string;
  taxKind: string;
  subtotalInPaise: number;
  cgstInPaise: number;
  sgstInPaise: number;
  igstInPaise: number;
  totalInPaise: number;
  issuedAt: string | null;
  voidReason: string | null;
};

type SequenceAudit = {
  financialYear: string;
  issued: number;
  expected: number;
  missing: number[];
  duplicates: string[];
};

const STATUSES = ['DRAFT', 'ISSUED', 'PAID', 'VOID'];

const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/** A number that reads as a number: 1,23,456.00 rather than 123456. */
function taxSummary(invoice: Invoice): string {
  if (invoice.taxKind === 'ZERO_RATED') return 'zero-rated';
  if (invoice.taxKind === 'IGST') return `IGST ${formatCurrencyFromPaise(invoice.igstInPaise)}`;
  return `CGST+SGST ${formatCurrencyFromPaise(invoice.cgstInPaise + invoice.sgstInPaise)}`;
}

export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; status?: string; financialYear?: string }>;
}) {
  const { customerId, status, financialYear } = await searchParams;

  const query = new URLSearchParams();
  if (customerId) query.set('customerId', customerId);
  if (status && STATUSES.includes(status)) query.set('status', status);
  if (financialYear && /^\d{4}-\d{2}$/.test(financialYear)) query.set('financialYear', financialYear);

  const [invoices, audit] = await Promise.all([
    apiAuthed<{ items: Invoice[]; total: number }>(
      'admin',
      `/admin/billing/invoices${query.size ? `?${query}` : ''}`,
    ),
    apiAuthed<SequenceAudit>(
      'admin',
      `/admin/billing/sequence${financialYear ? `?financialYear=${financialYear}` : ''}`,
    ),
  ]);

  if (!invoices.ok && invoices.error.code === 'UNAUTHENTICATED') redirect('/admin/login');

  const broken =
    audit.ok && (audit.data.missing.length > 0 || audit.data.duplicates.length > 0);

  return (
    <AdminShell
      title="Billing"
      description="Invoices and the state of the serial sequence."
    >
      {/* The sequence check leads, because a gap in it is the finding that
          matters and burying it under a table is how it goes unnoticed. */}
      {audit.ok ? (
        broken ? (
          <AlertCard
            severity="critical"
            title={`The ${audit.data.financialYear} sequence is not intact`}
            description={[
              audit.data.missing.length > 0
                ? `Missing serial${audit.data.missing.length === 1 ? '' : 's'}: ${audit.data.missing
                    .slice(0, 20)
                    .join(', ')}${audit.data.missing.length > 20 ? '…' : ''}.`
                : '',
              audit.data.duplicates.length > 0
                ? `Duplicate number${audit.data.duplicates.length === 1 ? '' : 's'}: ${audit.data.duplicates.join(', ')}.`
                : '',
              'A gap means either a defect or a row removed by hand. Both need explaining before an audit asks.',
            ]
              .filter(Boolean)
              .join(' ')}
          />
        ) : (
          <div className="rounded-xl border border-state-success/30 bg-state-success/5 p-4 text-sm">
            <span className="font-medium text-state-success">
              {audit.data.financialYear} sequence is intact
            </span>{' '}
            <span className="text-ink-muted">
              {/* "documents", not "invoices": credit notes take their numbers
                  from the same sequence and are counted here too. */}
              — {audit.data.issued} document{audit.data.issued === 1 ? '' : 's'} numbered 1 to{' '}
              {audit.data.expected}, no gaps and no duplicates.
            </span>
          </div>
        )
      ) : (
        <p className="text-sm text-ink-muted">{audit.error.message}</p>
      )}

      <form className="mt-6 flex flex-wrap items-end gap-3" action="/admin/billing">
        {/* Preserved so the customer filter survives applying a status. */}
        {customerId ? <input type="hidden" name="customerId" value={customerId} /> : null}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Financial year</span>
          <input
            type="text"
            name="financialYear"
            defaultValue={financialYear ?? ''}
            placeholder="2026-27"
            pattern="\d{4}-\d{2}"
            className="w-32 rounded-lg border border-line-input px-3 py-2 text-sm"
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
                {s.toLowerCase()}
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
        {!invoices.ok ? (
          <p className="text-sm text-ink-muted">{invoices.error.message}</p>
        ) : invoices.data.items.length === 0 ? (
          <div className="rounded-xl border border-line bg-white p-6">
            <h2 className="text-base font-semibold">No invoices match</h2>
            <p className="mt-1.5 text-sm text-ink-muted">
              {query.size ? 'Try a different filter.' : 'Invoices will appear here once issued.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Invoices, newest serial first
              </caption>
              <thead className="border-b border-line text-left text-ink-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Number</th>
                  <th scope="col" className="px-4 py-3 font-medium">Document</th>
                  <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                  <th scope="col" className="px-4 py-3 font-medium">Issued</th>
                  <th scope="col" className="px-4 py-3 font-medium">Tax</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.data.items.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                      {invoice.invoiceNumber ?? 'unnumbered draft'}
                    </td>
                    {/* Without this column a credit note reads as an invoice
                        for a negative amount, which is not the same document
                        and not what it does. */}
                    <td className="whitespace-nowrap px-4 py-3">
                      {invoice.kind === 'CREDIT_NOTE' ? (
                        <>
                          Credit note
                          {invoice.againstInvoiceNumber ? (
                            <span className="mt-0.5 block font-mono text-xs text-ink-muted">
                              against {invoice.againstInvoiceNumber}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        'Invoice'
                      )}
                    </td>
                    <td className="px-4 py-3">{invoice.customerName}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{date(invoice.issuedAt)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{taxSummary(invoice)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                      {formatCurrencyFromPaise(invoice.totalInPaise)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={invoice.status} />
                      {invoice.voidReason ? (
                        <span className="mt-1 block text-xs text-ink-muted">{invoice.voidReason}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Stated in the product, not only in a code comment: whoever runs
          billing needs to know this has not been through a CA. */}
      <p className="mt-6 max-w-prose text-sm text-ink-muted">
        GST treatment here follows the CGST and IGST Acts as read by the build team and is covered by
        tests, which is not the same as being reviewed. Have a Chartered Accountant check it before
        these invoices are issued to anyone.
      </p>
    </AdminShell>
  );
}
