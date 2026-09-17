import { formatCurrencyFromPaise, formatRelative } from '@/lib/format';

/**
 * Renders audit entries for either portal.
 *
 * The action string is turned into a sentence rather than shown raw: nobody
 * outside the build team reads "dns.record.updated" quickly, and a trail that is
 * hard to read is a trail nobody checks.
 *
 * Unknown actions fall back to the dotted name with the separators softened,
 * never to a blank or a guess. A new action appearing as
 * "billing invoice refunded" is honest; inventing prose for it is not.
 */
const PHRASES: Record<string, string> = {
  'auth.admin.signed_in': 'Staff signed in',
  'auth.customer.signed_in': 'Signed in',
  'admin.customer.created': 'Account created',
  'admin.customer.status_changed': 'Account status changed',
  'admin.customer.plan_assigned': 'Plan assigned',
  'admin.provider_account.created': 'Infrastructure account added',
  'admin.provider_account.status_changed': 'Infrastructure account status changed',
  'admin.provider_credential.added': 'Credential added',
  'admin.provider_credential.revoked': 'Credential revoked',
  'admin.website.sftp_configured': 'File access configured',
  'billing.invoice.issued': 'Invoice issued',
  'billing.invoice.voided': 'Invoice cancelled',
  'billing.credit_note.issued': 'Credit note issued',
  'dns.record.created': 'DNS record created',
  'dns.record.updated': 'DNS record updated',
  'dns.record.deleted': 'DNS record deleted',
  'files.saved': 'File saved',
  'files.deleted': 'File deleted',
  'files.renamed': 'File renamed',
  'files.folder_created': 'Folder created',
};

export type ActivityEntry = {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  createdAt: string;
  actor?: string | null;
  actorEmail?: string | null;
  customerId?: string | null;
  newValue?: unknown;
};

function describe(action: string): string {
  return PHRASES[action] ?? action.replace(/[._]/g, ' ');
}

/**
 * A one-line summary of what changed, from the recorded values.
 *
 * Only strings and numbers are shown. A nested object would either need
 * flattening rules nobody maintains or would render as "[object Object]", and
 * the detail is on the resource's own page anyway.
 */
function summarise(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const parts = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .slice(0, 3)
    .map(([key, v]) => {
      // Money is stored in paise everywhere, and the UI is where it becomes
      // rupees. "total in paise: 530900" is accurate and unreadable; nobody
      // checking a trail should be dividing by a hundred in their head.
      if (key.endsWith('InPaise') && typeof v === 'number') {
        return `${label(key.slice(0, -'InPaise'.length))}: ${formatCurrencyFromPaise(v)}`;
      }
      return `${label(key)}: ${v}`;
    });

  return parts.length > 0 ? parts.join(' · ') : null;
}

const label = (key: string) => key.replace(/([A-Z])/g, ' $1').toLowerCase();

export function ActivityList({ items }: { items: ActivityEntry[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-white p-6">
        <h2 className="text-base font-semibold">Nothing recorded yet</h2>
        <p className="mt-1.5 text-sm text-ink-muted">
          Actions are written to the trail as they happen.
        </p>
      </div>
    );
  }

  return (
    <ol className="overflow-hidden rounded-xl border border-line bg-white">
      {items.map((entry) => {
        const detail = summarise(entry.newValue);
        const actor = entry.actor ?? entry.actorEmail;

        return (
          <li
            key={entry.id}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-0"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{describe(entry.action)}</p>
              <p className="mt-0.5 text-sm text-ink-muted">
                {/* A system action has no actor, and says so rather than
                    leaving the space blank as if the name were missing. */}
                {actor ?? 'System'}
                {detail ? ` · ${detail}` : ''}
              </p>
            </div>
            <time
              dateTime={entry.createdAt}
              className="shrink-0 text-xs text-ink-subtle"
              title={new Date(entry.createdAt).toLocaleString('en-IN')}
            >
              {formatRelative(entry.createdAt)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
