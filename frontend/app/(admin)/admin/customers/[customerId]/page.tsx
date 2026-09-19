import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { apiAuthed } from '@/lib/api';
import { revalidatePath } from 'next/cache';
import { AdminShell } from '@/components/admin-shell';
import { AddUserForm, DatabasePanel } from '@/components/customer-admin-forms';
import { StatusBadge } from '@/components/status-badge';
import { formatCurrencyFromPaise } from '@/lib/format';

type CustomerDetail = {
  id: string;
  fullName: string;
  companyName: string | null;
  email: string;
  phone: string | null;
  status: string;
  billingState: string | null;
  gstin: string | null;
  createdAt: string;
  users: Array<{
    id: string;
    email: string;
    fullName: string;
    status: string;
    lastLoginAt: string | null;
  }>;
  websites: Array<{ id: string; domain: string; status: string }>;
  domains: Array<{ id: string; name: string; status: string; expiresAt: string | null }>;
  subscriptions: Array<{
    id: string;
    status: string;
    renewsAt: string;
    autoRenew: boolean;
    cancelledAt: string | null;
    plan: { name: string };
  }>;
};

type Invoice = {
  id: string;
  invoiceNumber: string | null;
  kind: 'INVOICE' | 'CREDIT_NOTE';
  status: string;
  totalInPaise: number;
  issuedAt: string | null;
};

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A list that says so when it is empty, rather than rendering nothing at all. */
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-muted">{children}</p>;
}

export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;

  // Two calls, not a fan-out: both read local state, and the invoice list is
  // what staff open this page for after the account itself.
  const [customer, invoices] = await Promise.all([
    apiAuthed<CustomerDetail>('admin', `/admin/customers/${customerId}`),
    apiAuthed<{ items: Invoice[]; total: number }>(
      'admin',
      `/admin/billing/invoices?customerId=${customerId}&take=5`,
    ),
  ]);

  if (!customer.ok) {
    if (customer.error.code === 'UNAUTHENTICATED') redirect('/admin/login');
    if (customer.error.code === 'RESOURCE_NOT_FOUND') notFound();
    return (
      <AdminShell title="Customer">
        <p className="text-sm text-ink-muted">{customer.error.message}</p>
      </AdminShell>
    );
  }

  async function addUser(input: { fullName: string; email: string }) {
    'use server';
    const created = await apiAuthed<{ id: string; temporaryPassword?: string }>(
      'admin',
      `/admin/customers/${customerId}/users`,
      { method: 'POST', body: input },
    );
    if (!created.ok) return { ok: false as const, message: created.error.message };
    revalidatePath(`/admin/customers/${customerId}`);
    return { ok: true as const, temporaryPassword: created.data.temporaryPassword };
  }

  async function listDatabases(websiteId: string) {
    'use server';
    const result = await apiAuthed<Array<{ name: string; user: string | null }>>(
      'admin',
      `/admin/websites/${websiteId}/databases`,
    );
    if (!result.ok) return { ok: false as const, message: result.error.message };
    return { ok: true as const, items: result.data };
  }

  async function createDatabase(
    websiteId: string,
    input: { name: string; user: string; password: string },
  ) {
    'use server';
    const done = await apiAuthed('admin', `/admin/websites/${websiteId}/databases`, {
      method: 'POST',
      body: input,
    });
    if (!done.ok) return { ok: false as const, message: done.error.message };
    return { ok: true as const };
  }

  async function deleteDatabase(websiteId: string, name: string) {
    'use server';
    const done = await apiAuthed(
      'admin',
      `/admin/websites/${websiteId}/databases/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
    if (!done.ok) return { ok: false as const, message: done.error.message };
    return { ok: true as const };
  }

  /** Fetched on demand and never stored: the link authenticates whoever holds it. */
  async function phpMyAdminLink(websiteId: string, name: string) {
    'use server';
    const result = await apiAuthed<{ link: string }>(
      'admin',
      `/admin/websites/${websiteId}/databases/${encodeURIComponent(name)}/phpmyadmin`,
    );
    if (!result.ok) return { ok: false as const, message: result.error.message };
    return { ok: true as const, link: result.data.link };
  }

  const c = customer.data;

  return (
    <AdminShell
      title={c.companyName ?? c.fullName}
      description={c.email}
      actions={<StatusBadge status={c.status} />}
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Account">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-ink-muted">Contact</dt>
            <dd>{c.fullName}</dd>
            <dt className="text-ink-muted">Phone</dt>
            <dd>{c.phone ?? 'Not available'}</dd>
            <dt className="text-ink-muted">Billing state</dt>
            {/* The GST state code decides CGST+SGST versus IGST, so a missing
                one is worth showing as missing rather than hiding the row. */}
            <dd>{c.billingState ?? 'Not set'}</dd>
            <dt className="text-ink-muted">GSTIN</dt>
            <dd>{c.gstin ?? 'Not registered'}</dd>
            <dt className="text-ink-muted">Customer since</dt>
            <dd>{date(c.createdAt)}</dd>
          </dl>
        </Panel>

        <Panel title="Sign-ins">
          {c.users.length === 0 ? (
            <Empty>No users on this account.</Empty>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {c.users.map((user) => (
                <li key={user.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{user.email}</span>
                  <span className="flex items-center gap-2 text-ink-muted">
                    {user.lastLoginAt ? `last in ${date(user.lastLoginAt)}` : 'never signed in'}
                    <StatusBadge status={user.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <AddUserForm action={addUser} />
          </div>
        </Panel>

        <Panel title="Websites">
          {c.websites.length === 0 ? (
            <Empty>No websites.</Empty>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {c.websites.map((site) => (
                <li key={site.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{site.domain}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={site.status} />
                    <DatabasePanel
                      websiteId={site.id}
                      websiteDomain={site.domain}
                      list={listDatabases}
                      create={createDatabase}
                      remove={deleteDatabase}
                      phpMyAdmin={phpMyAdminLink}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Domains">
          {c.domains.length === 0 ? (
            <Empty>No domains.</Empty>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {c.domains.map((domain) => (
                <li key={domain.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{domain.name}</span>
                  <span className="text-ink-muted">
                    {domain.expiresAt ? `expires ${date(domain.expiresAt)}` : 'no expiry recorded'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Subscriptions">
          {c.subscriptions.length === 0 ? (
            <Empty>No subscriptions.</Empty>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {c.subscriptions.map((sub) => (
                <li key={sub.id} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="flex items-center gap-2">
                    {sub.plan.name}
                    <StatusBadge status={sub.status} />
                  </span>
                  <span className="text-ink-muted">
                    {/* A cancelled subscription keeps running to the end of the
                        period already paid for, so the date is what matters. */}
                    {sub.cancelledAt
                      ? `cancelled, runs to ${date(sub.renewsAt)}`
                      : sub.autoRenew
                        ? `renews ${date(sub.renewsAt)}`
                        : `ends ${date(sub.renewsAt)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent invoices">
          {!invoices.ok ? (
            <Empty>{invoices.error.message}</Empty>
          ) : invoices.data.items.length === 0 ? (
            <Empty>Nothing invoiced yet.</Empty>
          ) : (
            <>
              <ul className="flex flex-col gap-2 text-sm">
                {invoices.data.items.map((invoice) => (
                  <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="font-mono text-xs">
                        {invoice.invoiceNumber ?? 'unnumbered draft'}
                      </span>
                      {invoice.kind === 'CREDIT_NOTE' ? (
                        <span className="ml-2 text-xs text-ink-muted">credit note</span>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-2">
                      {formatCurrencyFromPaise(invoice.totalInPaise)}
                      <StatusBadge status={invoice.status} />
                    </span>
                  </li>
                ))}
              </ul>
              {invoices.data.total > invoices.data.items.length ? (
                <Link
                  href={`/admin/billing?customerId=${c.id}`}
                  className="mt-3 inline-block text-sm text-primary hover:underline"
                >
                  All {invoices.data.total} invoices
                </Link>
              ) : null}
            </>
          )}
        </Panel>
      </div>
    </AdminShell>
  );
}
