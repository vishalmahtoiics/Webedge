'use client';

import Editor from '@monaco-editor/react';
// Points the loader at this origin. Must be imported before the editor mounts.
import './monaco-loader';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Monaco's language id, from the file extension. */
function languageFor(path: string): string {
  const name = path.split('/').pop() ?? '';
  if (/^\.htaccess$/i.test(name)) return 'apacheconf';

  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const map: Record<string, string> = {
    html: 'html', htm: 'html', css: 'css',
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
    php: 'php', json: 'json', xml: 'xml', md: 'markdown',
    yml: 'yaml', yaml: 'yaml', sql: 'sql', sh: 'shell', ini: 'ini', conf: 'ini',
  };
  return map[ext] ?? 'plaintext';
}

type SaveState = { status: 'idle' | 'saving' | 'saved' | 'error'; message?: string; at?: string };

export function FileEditor({
  path,
  initialContent,
  backHref,
  save,
}: {
  path: string;
  initialContent: string;
  backHref: string;
  save: (path: string, content: string) => Promise<{ error?: string }>;
}) {
  const [content, setContent] = useState(initialContent);
  const [state, setState] = useState<SaveState>({ status: 'idle' });
  const dirty = content !== initialContent;

  // Read by the keydown handler and the unload guard, which are registered once
  // and would otherwise close over a stale value.
  const latest = useRef({ content, dirty });
  latest.current = { content, dirty };

  const doSave = useCallback(async () => {
    if (!latest.current.dirty) return;

    setState({ status: 'saving' });
    const result = await save(path, latest.current.content);

    if (result.error) {
      // The content stays in the editor on failure — losing someone's edit
      // because the save failed is worse than the failure itself.
      setState({ status: 'error', message: result.error });
      return;
    }
    setState({
      status: 'saved',
      at: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    });
  }, [path, save]);

  // Ctrl/Cmd+S, because anyone editing a file will try it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void doSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doSave]);

  // Unsaved-changes guard on tab close or reload.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!latest.current.dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={backHref}
            onClick={(e) => {
              if (latest.current.dirty && !confirm('You have unsaved changes. Leave without saving?')) {
                e.preventDefault();
              }
            }}
            className="rounded-lg border border-line-input px-3 py-1.5 text-sm hover:border-line-strong"
          >
            Back to files
          </Link>
          <span className="font-mono text-sm text-ink-muted">{path}</span>
          {dirty ? (
            <span data-testid="dirty" className="text-xs text-state-warning">
              Unsaved changes
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <span aria-live="polite" data-testid="save-status" className="text-xs text-ink-subtle">
            {state.status === 'saving'
              ? 'Saving…'
              : state.status === 'saved'
                ? `Saved at ${state.at}`
                : ''}
          </span>
          <button
            type="button"
            onClick={() => void doSave()}
            disabled={!dirty || state.status === 'saving'}
            className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>

      {state.status === 'error' ? (
        <div role="alert" data-testid="editor-error" className="rounded-lg border border-state-danger/30 bg-state-danger/5 px-3 py-2.5 text-sm text-state-danger">
          {state.message} Your changes are still here — try saving again.
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-line">
        <Editor
          height="60vh"
          language={languageFor(path)}
          value={content}
          onChange={(value) => setContent(value ?? '')}
          loading={<div className="p-6 text-sm text-ink-muted">Loading editor…</div>}
          options={{
            // Off by default: on a phone-width screen it eats the content.
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}
