import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiAuthed } from '@/lib/api';
import { PortalShell } from '@/components/portal-shell';
import { AddRecordForm, type RecordFormState } from '@/components/dns-record-form';
import { DeleteRecordButton } from '@/components/delete-record-button';

type DnsRecord = {
  id: string;
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority: number | null;
  weight: number | null;
  port: number | null;
  managedByWebEdge: boolean;
};

type ZoneResponse = {
  domain: { id: string; name: string; dnsManaged: boolean };
  records: DnsRecord[];
};

export default async function DnsPage({ params }: { params: Promise<{ domainId: string }> }) {
  const { domainId } = await params;

  const result = await apiAuthed<ZoneResponse>('customer', `/customer/domains/${domainId}/dns`);
  if (!result.ok && result.error.code === 'UNAUTHENTICATED') redirect('/login');

  /**
   * The backend returns field-level errors, so the form marks the offending
   * input rather than showing one message above everything. Validation lives
   * there, not here — duplicating the DNS rules in the browser would mean two
   * implementations drifting apart.
   */
  async function addRecord(_state: RecordFormState, formData: FormData): Promise<RecordFormState> {
    'use server';

    const num = (key: string) => {
      const raw = formData.get(key);
      return raw === null || raw === '' ? undefined : Number(raw);
    };

    const body = {
      type: String(formData.get('type') ?? 'A'),
      name: String(formData.get('name') ?? '').trim(),
      value: String(formData.get('value') ?? '').trim(),
      ttl: num('ttl') ?? 3600,
      priority: num('priority'),
      weight: num('weight'),
      port: num('port'),
    };

    const created = await apiAuthed<DnsRecord>('customer', `/customer/domains/${domainId}/dns`, {
      method: 'POST',
      body,
    });

    if (!created.ok) {
      return {
        error: created.error.message,
        fields: (created.error.details?.fields as Record<string, string>) ?? {},
        values: body,
      };
    }

    revalidatePath(`/domains/${domainId}/dns`);
    return { success: `${body.type} record for ${body.name} created.` };
  }

  async function deleteRecord(recordId: string): Promise<void> {
    'use server';
    await apiAuthed('customer', `/customer/domains/${domainId}/dns/records/${recordId}`, {
      method: 'DELETE',
    });
    revalidatePath(`/domains/${domainId}/dns`);
  }

  if (!result.ok) {
    return (
      <PortalShell title="DNS">
        <p className="text-sm text-ink-muted">{result.error.message}</p>
      </PortalShell>
    );
  }

  const { domain, records } = result.data;

  return (
    <PortalShell title="DNS" description={`Records for ${domain.name}.`}>
      <div className="flex flex-col gap-6">
        <section className="overflow-hidden rounded-xl border border-line bg-white">
          <div className="hidden grid-cols-[80px_1fr_2fr_90px_40px] gap-3 border-b border-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle sm:grid">
            <span>Type</span>
            <span>Name</span>
            <span>Value</span>
            <span>TTL</span>
            <span className="sr-only">Actions</span>
          </div>

          {records.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-muted">No records yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {records.map((record) => (
                <li
                  key={record.id}
                  className="grid grid-cols-1 gap-1 px-4 py-3 text-sm sm:grid-cols-[80px_1fr_2fr_90px_40px] sm:items-center sm:gap-3"
                >
                  <span className="font-mono text-xs font-semibold">{record.type}</span>

                  <span className="min-w-0 break-words">
                    {record.name}
                    {record.managedByWebEdge ? (
                      <span className="ml-2 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-subtle">
                        Managed by WebEdge
                      </span>
                    ) : null}
                  </span>

                  {/* Technical values in mono, and allowed to wrap: a DKIM key
                      that is clipped is useless to copy. */}
                  <span className="min-w-0 break-all font-mono text-xs text-ink-muted">
                    {record.priority !== null ? `${record.priority} ` : ''}
                    {record.value}
                  </span>

                  <span className="tabular-nums text-xs text-ink-subtle">{record.ttl}s</span>

                  <DeleteRecordButton
                    recordId={record.id}
                    label={`${record.type} record ${record.name}`}
                    action={deleteRecord}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <AddRecordForm action={addRecord} />
      </div>
    </PortalShell>
  );
}
