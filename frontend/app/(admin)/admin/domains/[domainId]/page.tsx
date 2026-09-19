import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { apiAuthed } from '@/lib/api';
import { AdminShell } from '@/components/admin-shell';
import { AddRecordForm, type RecordFormState } from '@/components/dns-record-form';
import { DeleteRecordButton } from '@/components/delete-record-button';
import { PublishZoneButton } from '@/components/publish-zone-button';

/** Named for the row, not `Record` — that shadows the built-in generic. */
type DnsRow = {
  id: string;
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  providerSyncedAt: string | null;
};

type Zone = {
  domain: { id: string; name: string; dnsManaged: boolean; customerId: string; customerName: string };
  records: DnsRow[];
};

/**
 * One domain's DNS, for staff.
 *
 * Records live in WebEdge and are published to the provider deliberately, not
 * on every edit. Two reasons: a zone is edited in several steps and publishing
 * each one separately leaves the domain briefly wrong, and a push is a write to
 * a live account that should be something a person chose to do.
 *
 * What that costs is a gap between what this page shows and what is actually
 * serving, so the gap is stated rather than left to be discovered — per record,
 * and in the button.
 */
export default async function AdminDomainDnsPage({
  params,
}: {
  params: Promise<{ domainId: string }>;
}) {
  const { domainId } = await params;
  const result = await apiAuthed<Zone>('admin', `/admin/domains/${domainId}/dns`);
  if (!result.ok && result.error.code === 'UNAUTHENTICATED') redirect('/admin/login');

  async function addRecord(_state: RecordFormState, formData: FormData): Promise<RecordFormState> {
    'use server';
    const num = (key: string) => {
      const raw = formData.get(key);
      return raw === null || raw === '' ? undefined : Number(raw);
    };

    const created = await apiAuthed('admin', `/admin/domains/${domainId}/dns`, {
      method: 'POST',
      body: {
        type: String(formData.get('type') ?? 'A'),
        name: String(formData.get('name') ?? '').trim(),
        value: String(formData.get('value') ?? '').trim(),
        ttl: num('ttl') ?? 3600,
        priority: num('priority'),
        weight: num('weight'),
        port: num('port'),
      },
    });

    if (!created.ok) {
      const fields: Record<string, string> = {};
      const details = (created.error as { details?: { fields?: Array<{ field: string; message: string }> } })
        .details;
      for (const issue of details?.fields ?? []) fields[issue.field] = issue.message;
      return { error: created.error.message, fields };
    }

    revalidatePath(`/admin/domains/${domainId}`);
    return { success: 'Record added. Publish to make it live.' };
  }

  async function removeRecord(recordId: string) {
    'use server';
    await apiAuthed('admin', `/admin/domains/${domainId}/dns/records/${recordId}`, {
      method: 'DELETE',
    });
    revalidatePath(`/admin/domains/${domainId}`);
  }

  async function publish() {
    'use server';
    const done = await apiAuthed<{ published: number }>(
      'admin',
      `/admin/domains/${domainId}/dns/publish`,
      { method: 'POST' },
    );
    if (!done.ok) return { ok: false as const, message: done.error.message };
    revalidatePath(`/admin/domains/${domainId}`);
    return { ok: true as const, published: done.data.published };
  }

  if (!result.ok) {
    return (
      <AdminShell title="DNS">
        <p className="text-sm text-ink-muted">{result.error.message}</p>
      </AdminShell>
    );
  }

  const { domain, records } = result.data;
  const unpublished = records.filter((r) => r.providerSyncedAt === null).length;

  return (
    <AdminShell
      title={domain.name}
      description={`DNS records · ${domain.customerName}`}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/admin/domains"
            className="tap ring-focus rounded text-sm text-ink-muted underline decoration-line-strong underline-offset-4 hover:text-ink"
          >
            ← All domains
          </Link>
          <PublishZoneButton
            domainName={domain.name}
            recordCount={records.length}
            unpublished={unpublished}
            action={publish}
          />
        </div>

        {/* Said plainly, because the difference between the two is invisible
            otherwise and the page would look like the live truth. */}
        {unpublished > 0 ? (
          <p className="animate-fade-in rounded-xl border border-state-warning/30 bg-state-warning/5 p-4 text-sm">
            <span className="font-medium text-state-warning">
              {unpublished} {unpublished === 1 ? 'record is' : 'records are'} not live yet.
            </span>{' '}
            <span className="text-ink-muted">
              Changes stay in WebEdge until published, so a zone can be edited in several steps
              without the domain being briefly wrong in between.
            </span>
          </p>
        ) : null}

        <AddRecordForm action={addRecord} />

        {records.length === 0 ? (
          <div className="rounded-xl border border-line bg-white p-6">
            <h2 className="text-base font-semibold">No records</h2>
            <p className="mt-1.5 text-sm text-ink-muted">
              Nothing has been added here yet. Publishing an empty zone would remove whatever the
              provider currently serves, so add records first.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {records.map((record, index) => (
              <li
                key={record.id}
                className="enter grid gap-2 p-4 sm:grid-cols-[6rem_1fr_auto] sm:items-center"
                style={{ animationDelay: `${Math.min(index, 8) * 24}ms` }}
              >
                <span className="font-mono text-xs uppercase text-ink-muted">{record.type}</span>
                <div className="min-w-0">
                  <p className="truncate font-medium">{record.name}</p>
                  <p className="truncate text-sm text-ink-muted">{record.value}</p>
                </div>
                <div className="flex items-center gap-3 sm:justify-end">
                  <span className="text-xs text-ink-muted">TTL {record.ttl}</span>
                  {record.providerSyncedAt === null ? (
                    <span className="rounded-full border border-state-warning/30 bg-state-warning/5 px-2 py-0.5 text-[11px] text-state-warning">
                      Not live
                    </span>
                  ) : (
                    <span className="rounded-full border border-state-success/30 bg-state-success/5 px-2 py-0.5 text-[11px] text-state-success">
                      Live
                    </span>
                  )}
                  <DeleteRecordButton
                    recordId={record.id}
                    label={`${record.type} record for ${record.name}`}
                    action={removeRecord}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminShell>
  );
}
