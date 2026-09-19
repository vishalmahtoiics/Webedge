import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiAuthed } from '@/lib/api';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge } from '@/components/status-badge';
import {
  AddAccountForm,
  AddCredentialForm,
  SyncButton,
  VerifyButton,
} from '@/components/provider-forms';

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
  discovered: Array<{
    id: string;
    kind: string;
    /** Null when no key in the provider's payload matched a name. */
    name: string | null;
    status: string | null;
    expiresAt: string | null;
    unnamed: boolean;
    claimed: boolean;
    lastSeenAt: string;
  }>;
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

  async function addAccount(input: {
    accountName: string;
    productFamily?: string;
    websiteSlotsTotal?: number;
    notes?: string;
  }) {
    'use server';
    const created = await apiAuthed('admin', '/admin/providers', { method: 'POST', body: input });
    if (!created.ok) return { ok: false as const, message: created.error.message };
    revalidatePath('/admin/providers');
    return { ok: true as const };
  }

  /**
   * Read-only: every call the verification makes is a GET, which is what makes
   * it safe against a live account. It costs the account's request budget, so
   * it is a deliberate press rather than something a page load does.
   */
  async function verifyAccount(accountId: string) {
    'use server';
    const result = await apiAuthed<{
      usable: boolean;
      areas: Array<{ area: string; status: number | null; ok: boolean; count: number | null; detail?: string }>;
    }>('admin', `/admin/providers/${accountId}/verify`, { method: 'POST' });

    if (!result.ok) return { ok: false as const, message: result.error.message };
    revalidatePath('/admin/providers');
    return { ok: true as const, usable: result.data.usable, areas: result.data.areas };
  }

  /**
   * Read-only against the provider; writes locally. Pages then read that local
   * state instead of calling the provider on every load.
   */
  async function syncAccount(accountId: string) {
    'use server';
    const result = await apiAuthed<{
      totalStored: number;
      sources: Array<{
        area: string;
        ok: boolean;
        status: number | null;
        received: number | null;
        stored: number;
        skipped: number;
        unnamed: number;
        payloadKeys?: string[];
        detail?: string;
      }>;
    }>('admin', `/admin/providers/${accountId}/sync`, { method: 'POST' });

    if (!result.ok) return { ok: false as const, message: result.error.message };
    revalidatePath('/admin/providers');
    return { ok: true as const, totalStored: result.data.totalStored, sources: result.data.sources };
  }

  /**
   * The token crosses the network once, to this server action, and goes
   * straight to the API. It is never placed in a URL, a log line or a
   * revalidated payload — so the only copy that outlives the request is the
   * encrypted one in the database.
   */
  async function addCredential(
    accountId: string,
    input: { label: string; token: string; expiresAt?: string },
  ) {
    'use server';
    const created = await apiAuthed('admin', `/admin/providers/${accountId}/credentials`, {
      method: 'POST',
      body: input,
    });
    if (!created.ok) return { ok: false as const, message: created.error.message };
    revalidatePath('/admin/providers');
    return { ok: true as const };
  }

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
          <div className="mt-4">
            <AddAccountForm action={addAccount} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <AddAccountForm action={addAccount} />
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

                {account.discovered.length > 0 ? (
                  <div className="mt-4 rounded-lg border border-line p-4">
                    <p className="text-sm font-medium">
                      On this account · {account.discovered.length}{' '}
                      {account.discovered.length === 1 ? 'resource' : 'resources'}
                    </p>
                    <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                      {account.discovered.map((resource) => (
                        <li key={resource.id} className="flex items-baseline gap-2">
                          <span className="w-24 shrink-0 text-xs uppercase tracking-wide text-ink-muted">
                            {resource.kind.toLowerCase()}
                          </span>
                          {/* A resource whose name could not be read says so.
                              Rendering its id in a name's place would read as a
                              name and be believed. */}
                          {resource.name === null ? (
                            <span className="text-state-warning">Name not available</span>
                          ) : (
                            <span>{resource.name}</span>
                          )}
                          {resource.status ? (
                            <span className="text-xs text-ink-muted">{resource.status}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <VerifyButton
                    accountId={account.id}
                    hasCredential={active.length > 0}
                    action={verifyAccount}
                  />
                  <SyncButton
                    accountId={account.id}
                    hasCredential={active.length > 0}
                    action={syncAccount}
                  />
                </div>

                <AddCredentialForm
                  accountId={account.id}
                  accountName={account.accountName}
                  action={addCredential}
                />
              </li>
            );
          })}
          </ul>
        </div>
      )}
    </AdminShell>
  );
}
