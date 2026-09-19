'use client';

import { useState, useTransition } from 'react';

/**
 * Pushes WebEdge's records to the provider, replacing the zone there.
 *
 * A replace, not a merge — the panel's copy is the intended state — which is
 * exactly why the confirmation says what will be removed rather than asking
 * whether the person is sure. Publishing an empty zone takes a working domain
 * offline, and that is the one mistake worth spelling out.
 */
export function PublishZoneButton({
  domainName,
  recordCount,
  unpublished,
  action,
}: {
  domainName: string;
  recordCount: number;
  unpublished: number;
  action: () => Promise<{ ok: true; published: number } | { ok: false; message: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Awaited<ReturnType<typeof action>> | null>(null);

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const message =
            recordCount === 0
              ? `Publish an empty zone for ${domainName}?\n\n` +
                'This removes every record the provider is currently serving, which takes the ' +
                'domain offline.'
              : `Publish ${recordCount} record${recordCount === 1 ? '' : 's'} for ${domainName}?\n\n` +
                'This replaces the zone at the provider. Anything there that is not in WebEdge ' +
                'will be removed.';
          if (!confirm(message)) return;
          setResult(null);
          startTransition(async () => setResult(await action()));
        }}
        className="tap ring-focus rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
      >
        {pending ? 'Publishing…' : unpublished > 0 ? `Publish ${unpublished} change${unpublished === 1 ? '' : 's'}` : 'Republish zone'}
      </button>

      {result === null ? null : result.ok ? (
        <p className="animate-fade-in text-sm text-state-success">
          Published {result.published} record{result.published === 1 ? '' : 's'}.
        </p>
      ) : (
        <p role="alert" className="animate-fade-in max-w-sm text-right text-sm text-state-danger">
          {result.message}
        </p>
      )}
    </div>
  );
}
