'use client';

import { useTransition } from 'react';

/**
 * Runs the renewal sweep by hand.
 *
 * Confirmed, and the confirmation says what will happen in money terms rather
 * than asking "are you sure?" — pressing this issues real invoices against real
 * customers, and an invoice cannot be deleted afterwards, only credited.
 *
 * Pressing it twice is harmless: the sweep is idempotent, which is a property of
 * the sweep and not of this button. The `pending` state is here so nobody wonders
 * whether the first press registered, not because a second press would double
 * anything.
 */
export function RunSweepButton({
  action,
  dueCount,
}: {
  action: () => Promise<void>;
  dueCount: number;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const message =
          dueCount === 0
            ? 'Run the renewal sweep now?\n\nNothing is currently due, so this will issue no invoices.'
            : `Run the renewal sweep now?\n\nThis issues ${dueCount} invoice${
                dueCount === 1 ? '' : 's'
              }. An issued invoice cannot be deleted — only voided and credited.`;
        if (!confirm(message)) return;
        startTransition(() => void action());
      }}
      className="rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-ink disabled:opacity-50"
    >
      {pending ? 'Running…' : 'Run sweep now'}
    </button>
  );
}
