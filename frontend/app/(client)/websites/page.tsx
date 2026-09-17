import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiAuthed } from '@/lib/api';
import { PortalShell } from '@/components/portal-shell';

type Website = {
  id: string;
  domain: string;
  status: string;
  phpVersion: string | null;
  createdAt: string;
};

export default async function WebsitesPage() {
  const result = await apiAuthed<{ items: Website[]; total: number }>('customer', '/customer/websites');
  if (!result.ok && result.error.code === 'UNAUTHENTICATED') redirect('/login');

  return (
    <PortalShell title="Websites" description="Your websites and their files.">
      {!result.ok ? (
        <p className="text-sm text-ink-muted">{result.error.message}</p>
      ) : result.data.items.length === 0 ? (
        <div className="rounded-xl border border-line bg-white p-6">
          <h2 className="text-base font-semibold">No websites yet</h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            Add your first website to manage hosting, files and email in one place.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {result.data.items.map((site) => (
            <li
              key={site.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4"
            >
              <div className="min-w-0">
                <p className="font-medium">{site.domain}</p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {site.status.charAt(0) + site.status.slice(1).toLowerCase()}
                  {site.phpVersion ? ` · PHP ${site.phpVersion}` : ''}
                </p>
              </div>
              <Link
                href={`/websites/${site.id}/files`}
                className="rounded-lg border border-line-input px-3 py-1.5 text-sm hover:border-line-strong"
              >
                File manager
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PortalShell>
  );
}
