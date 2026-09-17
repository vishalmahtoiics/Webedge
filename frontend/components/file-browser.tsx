'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';

type FileEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modifiedAt: string;
  isSymlink: boolean;
};

/** Extensions the editor can open. Anything else is a download, not an edit. */
const EDITABLE = /\.(html?|css|js|mjs|cjs|ts|tsx|jsx|php|json|xml|md|txt|ya?ml|ini|conf|sql|sh)$|^\.(htaccess|gitignore|env\.example)$/i;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function FileBrowser({
  websiteId,
  path,
  entries,
  remove,
  createFolder,
}: {
  websiteId: string;
  path: string;
  entries: FileEntry[];
  remove: (path: string) => Promise<void>;
  createFolder: (path: string, name: string) => Promise<{ error?: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [newFolder, setNewFolder] = useState('');

  const segments = path.split('/').filter(Boolean);
  const href = (p: string) => `/websites/${websiteId}/files?path=${encodeURIComponent(p)}`;

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb doubles as the path bar. */}
      <nav aria-label="Path" className="flex flex-wrap items-center gap-1 text-sm">
        <Link href={href('/')} className="rounded px-1.5 py-0.5 font-mono text-primary hover:bg-primary-soft">
          /
        </Link>
        {segments.map((segment, i) => (
          <span key={`${segment}-${i}`} className="flex items-center gap-1">
            <span className="text-ink-subtle">/</span>
            <Link
              href={href(`/${segments.slice(0, i + 1).join('/')}`)}
              className="rounded px-1.5 py-0.5 font-mono text-primary hover:bg-primary-soft"
            >
              {segment}
            </Link>
          </span>
        ))}
      </nav>

      {error ? (
        <div role="alert" data-testid="file-error" className="rounded-lg border border-state-danger/30 bg-state-danger/5 px-3 py-2.5 text-sm text-state-danger">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={newFolder}
          onChange={(e) => setNewFolder(e.target.value)}
          placeholder="New folder name"
          aria-label="New folder name"
          className="h-9 rounded-lg border border-line-input bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
        <button
          type="button"
          disabled={pending || newFolder.trim() === ''}
          onClick={() => {
            setError(undefined);
            startTransition(async () => {
              const result = await createFolder(path, newFolder.trim());
              if (result.error) setError(result.error);
              else setNewFolder('');
            });
          }}
          className="h-9 rounded-lg border border-line-input px-3 text-sm hover:border-line-strong disabled:opacity-50"
        >
          Create folder
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-white">
        {entries.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-muted">This folder is empty.</p>
        ) : (
          <ul className="divide-y divide-line">
            {entries.map((entry) => {
              const editable = entry.type === 'file' && EDITABLE.test(entry.name);

              return (
                <li
                  key={entry.path}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
                >
                  <span className="w-5 shrink-0 text-center text-ink-subtle" aria-hidden="true">
                    {entry.type === 'directory' ? '▸' : entry.isSymlink ? '↳' : '·'}
                  </span>

                  <span className="min-w-0 flex-1 break-all">
                    {entry.type === 'directory' ? (
                      <Link href={href(entry.path)} className="font-mono text-primary hover:underline">
                        {entry.name}
                      </Link>
                    ) : editable ? (
                      <Link
                        href={`/websites/${websiteId}/files?edit=${encodeURIComponent(entry.path)}`}
                        className="font-mono text-primary hover:underline"
                      >
                        {entry.name}
                      </Link>
                    ) : (
                      <span className="font-mono">{entry.name}</span>
                    )}

                    {/* A symlink is shown rather than hidden, and labelled: it is
                        visible in the folder, but never followed. */}
                    {entry.isSymlink ? (
                      <span className="ml-2 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-subtle">
                        Link — not followed
                      </span>
                    ) : null}
                  </span>

                  <span className="shrink-0 tabular-nums text-xs text-ink-subtle">
                    {entry.type === 'directory' ? '—' : formatSize(entry.size)}
                  </span>

                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`Delete ${entry.name}`}
                    onClick={() => {
                      if (
                        !confirm(
                          `Delete ${entry.name}?\n\n` +
                            (entry.type === 'directory'
                              ? 'This deletes the folder and everything inside it.'
                              : 'This cannot be undone.'),
                        )
                      )
                        return;
                      setError(undefined);
                      startTransition(() => void remove(entry.path));
                    }}
                    className="shrink-0 rounded-lg border border-line px-2 py-1 text-xs text-ink-muted hover:border-state-danger hover:text-state-danger disabled:opacity-50"
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
