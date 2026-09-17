import { redirect } from 'next/navigation';
import { apiAuthed } from '@/lib/api';
import { PortalShell } from '@/components/portal-shell';
import { ActivityList, type ActivityEntry } from '@/components/activity-list';

export default async function CustomerActivityPage() {
  const result = await apiAuthed<{ items: ActivityEntry[]; total: number }>(
    'customer',
    '/customer/activity',
  );
  if (!result.ok && result.error.code === 'UNAUTHENTICATED') redirect('/login');

  return (
    <PortalShell
      title="Activity"
      description="Changes made to your account, by you and by our support team."
    >
      {!result.ok ? (
        <p className="text-sm text-ink-muted">{result.error.message}</p>
      ) : (
        <ActivityList items={result.data.items} />
      )}
    </PortalShell>
  );
}
