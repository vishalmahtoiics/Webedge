import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiAuthed } from '@/lib/api';
import { PortalShell } from '@/components/portal-shell';

type Domain = {
  id: string;
  name: string;
  status: string;
  expiresAt: string | null;
  autoRenew: boolean;
  dnsManaged: boolean;
};

export default async function DomainsPage() {
  const result = await apiAuthed<{ items: Domain[]; total: number }>('customer', '/customer/domains');
  if (!result.ok && result.error.code === 'UNAUTHENTICATED') redirect('/login');

  return (
    <PortalShell title="Domains" description="Your domains, their expiry and DNS.">
      {!result.ok ? (
        <p className="text-sm text-ink-muted">{result.error.message}</p>
      ) : result.data.items.length === 0 ? (
        <div className="rounded-xl border border-line bg-white p-6">
          <h2 className="text-base font-semibold">No domains yet</h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            Domains you register or connect will appear here.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {result.data.items.map((domain) => (
            <li
              key={domain.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4"
            >
              <div className="min-w-0">
                <p className="font-medium">{domain.name}</p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {domain.expiresAt
                    ? `Expires ${new Date(domain.expiresAt).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}`
                    : 'No expiry recorded'}
                  {domain.autoRenew ? '' : ' · auto-renew off'}
                </p>
              </div>
              <Link
                href={`/domains/${domain.id}/dns`}
                className="rounded-lg border border-line-input px-3 py-1.5 text-sm hover:border-line-strong"
              >
                Manage DNS
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PortalShell>
  );
}
