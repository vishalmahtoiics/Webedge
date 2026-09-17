import { redirect } from 'next/navigation';
import { apiAuthed } from '@/lib/api';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge } from '@/components/status-badge';

/**
 * Provider accounts.
 *
 * This is the one surface where the upstream provider is named, and it is
 * staff-only: an operator cannot configure an account without knowing which
 * provider it belongs to. Nothing here is reachable from the customer portal,
 * and no field on this page is rendered anywhere a customer can see.
 *
 * Note what is absent: credential values. The API returns only metadata — a
 * label, the last four characters, the key version and dates — because there is
 * no endpoint that decrypts a token. This page could not show one if it tried.
 */

type ProviderAccount = {
  id: string;
  provider: string;
  accountName: string;
  status: string;
  productFamily: string | null;
  isolatesWebsites: boolean;
  websiteSlotsUsed: number;
  websiteSlotsTotal: number | null;
  lastSyncedAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  rateLimit: { remaining: number; limit: number };
  credentials: Array<{
    id: string;
    label: string;
    lastFour: string | null;
    keyVersion: string;
    expiresAt: string | null;
    lastVerifiedAt: string | null;
    revokedAt: string | null;
  }>;
};

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

export default async function AdminProvidersPage() {
  const result = await apiAuthed<ProviderAccount[]>('admin', '/admin/providers');
  if (!result.ok && result.error.code === 'UNAUTHENTICATED') redirect('/admin/login');

  return (
    <AdminShell
      title="Infrastructure"
      description="Upstream accounts, their credentials and capacity. Staff only."
    >
      {!result.ok ? (
        <p className="text-sm text-ink-muted">{result.error.message}</p>
      ) : result.data.length === 0 ? (
        <div className="rounded-xl border border-line bg-white p-6">
          <h2 className="text-base font-semibold">No accounts connected</h2>
          <p className="mt-1.5 max-w-prose text-sm text-ink-muted">
            Add an account and its API credential to start mapping customer resources onto it.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {result.data.map((account) => {
            const active = account.credentials.filter((c) => !c.revokedAt);

            return (
              <li key={account.id} className="rounded-xl border border-line bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex items-center gap-2 font-medium">
                      {account.accountName}
                      <StatusBadge status={account.status} />
                    </p>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {account.provider.toLowerCase()}
                      {account.productFamily ? ` · ${account.productFamily}` : ''}
                    </p>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {/* A capacity with no known ceiling is stated as unknown,
                        never rendered as a full bar against a guessed total. */}
                    {account.websiteSlotsTotal === null
                      ? `${account.websiteSlotsUsed} websites · limit not available`
                      : `${account.websiteSlotsUsed} of ${account.websiteSlotsTotal} websites`}
                  </p>
                </div>

                {/* Shared hosting puts every website under one account. Worth
                    saying on this page, because it is why a customer's site
                    cannot simply be moved between accounts. */}
                {account.isolatesWebsites ? null : (
                  <p className="mt-3 rounded-lg border border-state-info/30 bg-state-info/5 p-3 text-sm text-ink-muted">
                    Websites on this account share one filesystem and one set of credentials.
                  </p>
                )}

                {account.lastError ? (
                  <p className="mt-3 rounded-lg border border-state-danger/30 bg-state-danger/5 p-3 text-sm">
                    <span className="font-medium text-state-danger">Last error</span>{' '}
                    <span className="text-ink-muted">
                      {account.lastError}
                      {when(account.lastErrorAt) ? ` · ${when(account.lastErrorAt)}` : ''}
                    </span>
                  </p>
                ) : null}

                <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                  <dt className="text-ink-muted">Last synced</dt>
                  <dd>{when(account.lastSyncedAt) ?? 'Never'}</dd>
                  <dt className="text-ink-muted">Request budget</dt>
                  <dd>
                    {account.rateLimit.remaining} of {account.rateLimit.limit} remaining
                  </dd>
                  <dt className="text-ink-muted">Credentials</dt>
                  <dd>
                    {active.length === 0 ? (
                      <span className="text-state-warning">
                        None active — nothing on this account can be provisioned.
                      </span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {active.map((credential) => (
                          <li key={credential.id}>
                            {credential.label} ·{' '}
                            <span className="font-mono text-xs">
                              ····{credential.lastFour ?? '????'}
                            </span>{' '}
                            · key {credential.keyVersion}
                            {credential.expiresAt ? ` · expires ${when(credential.expiresAt)}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </AdminShell>
  );
}
