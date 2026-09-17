import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { apiAuthed } from '@/lib/api';
import { PortalShell } from '@/components/portal-shell';
import { StatusBadge } from '@/components/status-badge';
import { AddAliasForm, AddMailboxForm, VerifyDomainButton, type FormState } from '@/components/mail-forms';

type Domain = {
  id: string;
  name: string;
  status: string;
  verifiedAt: string | null;
  mailboxes: number;
  aliases: number;
  challenge: { host: string; type: string; value: string };
};

type Mailbox = {
  id: string;
  address: string;
  displayName: string | null;
  quotaMib: number | null;
  usedMib: number | null;
  isActive: boolean;
};

type Alias = {
  id: string;
  address: string;
  destinations: string[];
  isActive: boolean;
};

/** Storage with no measurement says so. A zero would read as an empty mailbox. */
function usage(mailbox: Mailbox): string {
  if (mailbox.usedMib === null) {
    return mailbox.quotaMib === null ? 'Usage not available' : `Usage not available · ${mailbox.quotaMib} MB limit`;
  }
  return mailbox.quotaMib === null
    ? `${mailbox.usedMib} MB used`
    : `${mailbox.usedMib} of ${mailbox.quotaMib} MB used`;
}

export default async function MailDomainPage({
  params,
}: {
  params: Promise<{ domainId: string }>;
}) {
  const { domainId } = await params;

  const [domain, mailboxes, aliases] = await Promise.all([
    apiAuthed<Domain>('customer', `/customer/mail/domains/${domainId}`),
    apiAuthed<{ items: Mailbox[]; total: number }>(
      'customer',
      `/customer/mail/domains/${domainId}/mailboxes`,
    ),
    apiAuthed<{ items: Alias[]; total: number }>(
      'customer',
      `/customer/mail/domains/${domainId}/aliases`,
    ),
  ]);

  if (!domain.ok) {
    if (domain.error.code === 'UNAUTHENTICATED') redirect('/login');
    if (domain.error.code === 'RESOURCE_NOT_FOUND') notFound();
    return (
      <PortalShell title="Email">
        <p className="text-sm text-ink-muted">{domain.error.message}</p>
      </PortalShell>
    );
  }

  const active = domain.data.status === 'ACTIVE';

  async function verify(): Promise<FormState> {
    'use server';
    const result = await apiAuthed('customer', `/customer/mail/domains/${domainId}/verify`, {
      method: 'POST',
    });
    if (!result.ok) return { error: result.error.message };

    revalidatePath(`/mail/${domainId}`);
    return { success: 'Verified. You can add mailboxes now.' };
  }

  async function addMailbox(_state: FormState, formData: FormData): Promise<FormState> {
    'use server';
    const localPart = String(formData.get('localPart') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const quotaRaw = String(formData.get('quotaMib') ?? '').trim();

    if (!localPart) return { error: 'Enter an address.' };
    if (password.length < 12) return { error: 'Use a password of at least 12 characters.' };

    const result = await apiAuthed<{ address: string }>(
      'customer',
      `/customer/mail/domains/${domainId}/mailboxes`,
      {
        method: 'POST',
        body: {
          localPart,
          password,
          ...(quotaRaw ? { quotaMib: Number(quotaRaw) } : {}),
        },
      },
    );
    if (!result.ok) return { error: result.error.message };

    revalidatePath(`/mail/${domainId}`);
    return { success: `${result.data.address} created.` };
  }

  async function addAlias(_state: FormState, formData: FormData): Promise<FormState> {
    'use server';
    const localPart = String(formData.get('localPart') ?? '').trim();
    const destinations = String(formData.get('destinations') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (!localPart) return { error: 'Enter an address.' };
    if (destinations.length === 0) return { error: 'Enter at least one destination.' };

    const result = await apiAuthed('customer', `/customer/mail/domains/${domainId}/aliases`, {
      method: 'POST',
      body: { localPart, destinations },
    });
    if (!result.ok) return { error: result.error.message };

    revalidatePath(`/mail/${domainId}`);
    return { success: `${localPart}@${domain.ok ? domain.data.name : ''} created.` };
  }

  return (
    <PortalShell
      title={domain.data.name}
      description="Mailboxes and forwarding for this domain."
      meta={<StatusBadge status={domain.data.status} />}
    >
      <Link href="/mail" className="text-sm text-primary hover:underline">
        ← All domains
      </Link>

      {!active ? (
        <section className="mt-4 rounded-xl border border-state-warning/30 bg-state-warning/5 p-5">
          <h2 className="text-base font-semibold">Prove the domain is yours</h2>
          <p className="mt-1.5 max-w-prose text-sm text-ink-muted">
            Add this TXT record at your DNS provider. Until it is in place we will not accept mail
            for {domain.data.name} — without that check, anyone could claim a domain and receive
            its mail.
          </p>

          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-ink-muted">Name</dt>
            <dd className="break-all font-mono text-xs">{domain.data.challenge.host}</dd>
            <dt className="text-ink-muted">Type</dt>
            <dd className="font-mono text-xs">{domain.data.challenge.type}</dd>
            <dt className="text-ink-muted">Value</dt>
            <dd className="break-all font-mono text-xs">{domain.data.challenge.value}</dd>
          </dl>

          <VerifyDomainButton action={verify} />
          <p className="mt-2 text-sm text-ink-muted">DNS changes can take a few minutes to appear.</p>
        </section>
      ) : null}

      <section className="mt-6 rounded-xl border border-line bg-white p-5">
        <h2 className="text-base font-semibold">Mailboxes</h2>
        {!active ? (
          <p className="mt-1.5 text-sm text-ink-muted">
            Available once the domain is verified.
          </p>
        ) : (
          <div className="mt-3">
            <AddMailboxForm action={addMailbox} />
          </div>
        )}

        <div className="mt-5">
          {!mailboxes.ok ? (
            <p className="text-sm text-ink-muted">{mailboxes.error.message}</p>
          ) : mailboxes.data.items.length === 0 ? (
            <p className="text-sm text-ink-muted">No mailboxes on this domain.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {mailboxes.data.items.map((mailbox) => (
                <li
                  key={mailbox.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-sm first:border-0 first:pt-0"
                >
                  <span className="flex items-center gap-2">
                    {mailbox.address}
                    {mailbox.isActive ? null : <StatusBadge status="SUSPENDED" />}
                  </span>
                  <span className="text-ink-muted">{usage(mailbox)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-line bg-white p-5">
        <h2 className="text-base font-semibold">Forwarding</h2>
        <p className="mt-1.5 max-w-prose text-sm text-ink-muted">
          An alias forwards mail to one or more addresses without a mailbox of its own.
        </p>
        {active ? (
          <div className="mt-3">
            <AddAliasForm action={addAlias} />
          </div>
        ) : null}

        <div className="mt-5">
          {!aliases.ok ? (
            <p className="text-sm text-ink-muted">{aliases.error.message}</p>
          ) : aliases.data.items.length === 0 ? (
            <p className="text-sm text-ink-muted">No forwarding set up.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {aliases.data.items.map((alias) => (
                <li
                  key={alias.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line pt-2 text-sm first:border-0 first:pt-0"
                >
                  <span>{alias.address}</span>
                  <span className="text-ink-muted">→ {alias.destinations.join(', ')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </PortalShell>
  );
}
