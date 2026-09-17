import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { apiAuthed } from '@/lib/api';
import { PortalShell } from '@/components/portal-shell';
import { FileBrowser } from '@/components/file-browser';
import { FileEditor } from '@/components/file-editor';

type FileEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modifiedAt: string;
  isSymlink: boolean;
};

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ websiteId: string }>;
  searchParams: Promise<{ path?: string; edit?: string }>;
}) {
  const { websiteId } = await params;
  const { path = '/', edit } = await searchParams;

  const base = `/customer/websites/${websiteId}/files`;

  async function save(filePath: string, content: string): Promise<{ error?: string }> {
    'use server';
    const result = await apiAuthed(`customer`, `${base}/content`, {
      method: 'PUT',
      body: { path: filePath, content },
    });
    if (!result.ok) return { error: result.error.message };

    revalidatePath(`/websites/${websiteId}/files`);
    return {};
  }

  async function remove(filePath: string): Promise<void> {
    'use server';
    await apiAuthed('customer', `${base}?path=${encodeURIComponent(filePath)}`, { method: 'DELETE' });
    revalidatePath(`/websites/${websiteId}/files`);
  }

  async function createFolder(atPath: string, name: string): Promise<{ error?: string }> {
    'use server';
    const result = await apiAuthed('customer', `${base}/folders`, {
      method: 'POST',
      body: { path: atPath, name },
    });
    if (!result.ok) return { error: result.error.message };

    revalidatePath(`/websites/${websiteId}/files`);
    return {};
  }

  // Editing one file: fetch only that file, not the whole listing.
  if (edit) {
    const file = await apiAuthed<{ path: string; content: string; size: number }>(
      'customer',
      `${base}/content?path=${encodeURIComponent(edit)}`,
    );
    if (!file.ok && file.error.code === 'UNAUTHENTICATED') redirect('/login');

    return (
      <PortalShell title="Editor" description={edit}>
        {!file.ok ? (
          <div className="rounded-xl border border-line bg-white p-6">
            <h2 className="text-base font-semibold">This file can&rsquo;t be edited</h2>
            <p className="mt-1.5 text-sm text-ink-muted">{file.error.message}</p>
            <a
              href={`/websites/${websiteId}/files?path=${encodeURIComponent(parentOf(edit))}`}
              className="mt-4 inline-block rounded-lg border border-line-input px-3 py-1.5 text-sm"
            >
              Back to files
            </a>
          </div>
        ) : (
          <FileEditor
            path={file.data.path}
            initialContent={file.data.content}
            backHref={`/websites/${websiteId}/files?path=${encodeURIComponent(parentOf(edit))}`}
            save={save}
          />
        )}
      </PortalShell>
    );
  }

  const listing = await apiAuthed<{ path: string; entries: FileEntry[] }>(
    'customer',
    `${base}?path=${encodeURIComponent(path)}`,
  );
  if (!listing.ok && listing.error.code === 'UNAUTHENTICATED') redirect('/login');

  return (
    <PortalShell title="Files" description="Browse and edit your website's files.">
      {!listing.ok ? (
        <div className="rounded-xl border border-line bg-white p-6">
          <h2 className="text-base font-semibold">
            {listing.error.code === 'CAPABILITY_UNAVAILABLE'
              ? 'File management isn’t available yet'
              : 'We couldn’t load your files'}
          </h2>
          <p className="mt-1.5 max-w-prose text-sm text-ink-muted">{listing.error.message}</p>
        </div>
      ) : (
        <FileBrowser
          websiteId={websiteId}
          path={listing.data.path}
          entries={listing.data.entries}
          remove={remove}
          createFolder={createFolder}
        />
      )}
    </PortalShell>
  );
}

function parentOf(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean);
  parts.pop();
  return parts.length === 0 ? '/' : `/${parts.join('/')}`;
}
