'use client';

import { useTransition } from 'react';

/**
 * Deleting a DNS record can take a site or its email offline, so it is
 * confirmed and names the record rather than asking "are you sure?".
 */
export function DeleteRecordButton({
  recordId,
  label,
  action,
}: {
  recordId: string;
  label: string;
  action: (recordId: string) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-label={`Delete ${label}`}
      onClick={() => {
        if (!confirm(`Delete the ${label}?\n\nThis can take your website or email offline.`)) return;
        startTransition(() => void action(recordId));
      }}
      className="justify-self-start rounded-lg border border-line px-2 py-1 text-xs text-ink-muted hover:border-state-danger hover:text-state-danger disabled:opacity-50 sm:justify-self-end"
    >
      {pending ? '…' : 'Delete'}
    </button>
  );
}
