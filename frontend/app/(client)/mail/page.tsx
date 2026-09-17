import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiAuthed } from '@/lib/api';
import { PortalShell } from '@/components/portal-shell';
import { StatusBadge } from '@/components/status-badge';
import { AddDomainForm, type FormState } from '@/components/mail-forms';

type MailDomain = {
  id: string;
  name: string;
  status: string;
  verifiedAt: string | null;
};

export default async function MailPage() {
  const result = await apiAuthed<{ items: MailDomain[]; total: number }>(
    'customer',
    '/customer/mail/domains',
  );
  if (!result.ok && result.error.code === 'UNAUTHENTICATED') redirect('/login');

  async function addDomain(_state: FormState, formData: FormData): Promise<FormState> {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return { error: 'Enter a domain name.' };

    const created = await apiAuthed<{ id: string }>('customer', '/customer/mail/domains', {
      method: 'POST',
      body: { name },
    });
    if (!created.ok) return { error: created.error.message };

    revalidatePath('/mail');
    return { success: `${name} added. Publish the verification record to finish.` };
  }

  return (
    <PortalShell title="Email" description="Mail domains, mailboxes and forwarding.">
      <section className="rounded-xl border border-line bg-white p-5">
        <h2 className="text-base font-semibold">Add a domain</h2>
        <div className="mt-3">
          <AddDomainForm action={addDomain} />
        </div>
      </section>

      <div className="mt-6">
        {!result.ok ? (
          <p className="text-sm text-ink-muted">{result.error.message}</p>
        ) : result.data.items.length === 0 ? (
          <div className="rounded-xl border border-line bg-white p-6">
            <h2 className="text-base font-semibold">No mail domains yet</h2>
            <p className="mt-1.5 text-sm text-ink-muted">
              Add a domain above to start creating mailboxes on it.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {result.data.items.map((domain) => (
              <li key={domain.id}>
                <Link
                  href={`/mail/${domain.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4 hover:border-line-strong"
                >
                  <span className="flex items-center gap-2 font-medium">
                    {domain.name}
                    <StatusBadge status={domain.status} />
                  </span>
                  <span className="text-sm text-ink-muted">
                    {/* Pending is not an error, and says what to do next. */}
                    {domain.verifiedAt
                      ? `Verified ${new Date(domain.verifiedAt).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}`
                      : 'Publish the verification record to finish setup'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PortalShell>
  );
}
