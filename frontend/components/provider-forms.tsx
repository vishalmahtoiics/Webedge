'use client';

import { useRef, useState, useTransition } from 'react';

/**
 * Adding an upstream account and its API credential.
 *
 * The token field is the reason this is a client component rather than a plain
 * form: it is cleared the moment it is submitted, and never re-rendered from
 * any response. The API has no endpoint that decrypts a token, so a form that
 * repopulated the field would be the one place in the system where a stored
 * credential could be read back — and it would do it in the browser.
 */

const field =
  'w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-ink focus:outline-none';
const label = 'block text-sm font-medium';
const hint = 'mt-1 text-xs text-ink-muted';

type Result = { ok: true } | { ok: false; message: string };

export function AddAccountForm({
  action,
}: {
  action: (input: {
    accountName: string;
    productFamily?: string;
    websiteSlotsTotal?: number;
    notes?: string;
  }) => Promise<Result>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-ink"
      >
        Add an account
      </button>
    );
  }

  return (
    <form
      ref={form}
      className="flex flex-col gap-4 rounded-xl border border-line bg-white p-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);
        const slots = String(data.get('websiteSlotsTotal') ?? '').trim();

        startTransition(async () => {
          const result = await action({
            accountName: String(data.get('accountName') ?? '').trim(),
            productFamily: String(data.get('productFamily') ?? '') || undefined,
            websiteSlotsTotal: slots === '' ? undefined : Number(slots),
            notes: String(data.get('notes') ?? '').trim() || undefined,
          });
          if (result.ok) {
            form.current?.reset();
            setOpen(false);
          } else {
            setError(result.message);
          }
        });
      }}
    >
      <h2 className="text-base font-semibold">Add an upstream account</h2>

      <div>
        <label className={label} htmlFor="accountName">
          Account name
        </label>
        <input id="accountName" name="accountName" required minLength={2} maxLength={80} className={field} />
        <p className={hint}>
          Your name for it, not the provider&rsquo;s. It appears only on staff pages.
        </p>
      </div>

      <div>
        <label className={label} htmlFor="productFamily">
          Product family
        </label>
        <select id="productFamily" name="productFamily" className={field} defaultValue="">
          <option value="">Not specified</option>
          <option value="agency-hosting">Agency hosting (isolated websites)</option>
          <option value="shared">Shared (one filesystem for every website)</option>
        </select>
        <p className={hint}>
          Decides what WebEdge will attempt on this account. Shared hosting puts every website
          under one set of credentials, which is why a site cannot be moved between accounts.
        </p>
      </div>

      <div>
        <label className={label} htmlFor="websiteSlotsTotal">
          Website limit
        </label>
        <input
          id="websiteSlotsTotal"
          name="websiteSlotsTotal"
          type="number"
          min={1}
          max={10000}
          className={field}
        />
        <p className={hint}>
          Leave empty if you do not know it. Capacity then reads &ldquo;limit not available&rdquo;
          rather than showing a bar against a guessed number.
        </p>
      </div>

      <div>
        <label className={label} htmlFor="notes">
          Notes
        </label>
        <textarea id="notes" name="notes" rows={2} maxLength={2000} className={field} />
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-state-danger/30 bg-state-danger/5 p-3 text-sm text-state-danger">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Adding…' : 'Add account'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          className="rounded-lg border border-line px-3 py-2 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function AddCredentialForm({
  accountId,
  accountName,
  action,
}: {
  accountId: string;
  accountName: string;
  action: (
    accountId: string,
    input: { label: string; token: string; expiresAt?: string },
  ) => Promise<Result>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-ink"
      >
        Add API token
      </button>
    );
  }

  return (
    <form
      ref={form}
      className="mt-3 flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);
        const token = String(data.get('token') ?? '');
        const expiresAt = String(data.get('expiresAt') ?? '').trim();

        startTransition(async () => {
          const result = await action(accountId, {
            label: String(data.get('label') ?? '').trim(),
            token,
            // A date input gives YYYY-MM-DD; the API wants a full timestamp.
            expiresAt: expiresAt === '' ? undefined : `${expiresAt}T00:00:00.000Z`,
          });
          // Cleared either way. A token left sitting in a form field survives
          // in the DOM, in a screenshot, and in whatever the browser decides to
          // autofill next.
          form.current?.reset();
          if (result.ok) setOpen(false);
          else setError(result.message);
        });
      }}
    >
      <p className="text-sm font-medium">API token for {accountName}</p>

      <div>
        <label className={label} htmlFor={`label-${accountId}`}>
          Label
        </label>
        <input
          id={`label-${accountId}`}
          name="label"
          required
          minLength={2}
          maxLength={80}
          placeholder="e.g. panel-read-write"
          className={field}
        />
        <p className={hint}>How you will recognise it when rotating.</p>
      </div>

      <div>
        <label className={label} htmlFor={`token-${accountId}`}>
          Token
        </label>
        <input
          id={`token-${accountId}`}
          name="token"
          type="password"
          required
          minLength={8}
          maxLength={4096}
          autoComplete="off"
          spellCheck={false}
          className={`${field} font-mono`}
        />
        <p className={hint}>
          Encrypted with AES-256-GCM before it is stored. Nothing in WebEdge can read it back —
          only the last four characters are ever shown again, so keep your own copy.
        </p>
      </div>

      <div>
        <label className={label} htmlFor={`expires-${accountId}`}>
          Expires
        </label>
        <input id={`expires-${accountId}`} name="expiresAt" type="date" className={field} />
        <p className={hint}>Optional. Set it if the provider issued the token with an expiry.</p>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-state-danger/30 bg-state-danger/5 p-3 text-sm text-state-danger">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save token'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); form.current?.reset(); }}
          className="rounded-lg border border-line px-3 py-1.5 text-xs"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}


/**
 * Asks the provider whether this account's token works, and shows what it
 * reached.
 *
 * Per product area, because a token inherits the permissions of the person who
 * created it: reaching domains but not VPS is the ordinary case, not a fault.
 * The provider's own words are shown on a failure — for a wrong scope they are
 * the most useful sentence on the page, and they are safe to render because the
 * token travelled in a header the provider never echoes back.
 */
export function VerifyButton({
  accountId,
  hasCredential,
  action,
}: {
  accountId: string;
  hasCredential: boolean;
  action: (accountId: string) => Promise<
    | {
        ok: true;
        usable: boolean;
        areas: Array<{ area: string; status: number | null; ok: boolean; count: number | null; detail?: string }>;
      }
    | { ok: false; message: string }
  >;
}) {
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<Awaited<ReturnType<typeof action>> | null>(null);

  if (!hasCredential) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setReport(null);
          startTransition(async () => setReport(await action(accountId)));
        }}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-ink disabled:opacity-50"
      >
        {pending ? 'Testing…' : 'Test connection'}
      </button>

      {report === null ? null : !report.ok ? (
        <p role="alert" className="mt-2 rounded-lg border border-state-danger/30 bg-state-danger/5 p-3 text-sm text-state-danger">
          {report.message}
        </p>
      ) : (
        <div
          className={`mt-2 rounded-lg border p-3 text-sm ${
            report.usable
              ? 'border-state-success/30 bg-state-success/5'
              : 'border-state-danger/30 bg-state-danger/5'
          }`}
        >
          <p className="font-medium">
            {report.usable
              ? 'The token works.'
              : 'The provider accepted nothing this token asked for.'}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {report.areas.map((area) => (
              <li key={area.area} className="flex flex-wrap items-baseline gap-2">
                <span className="w-20 shrink-0 text-ink-muted">{area.area}</span>
                <span className={area.ok ? 'text-state-success' : 'text-state-danger'}>
                  {area.ok ? '✓' : '✕'} {area.status ?? 'no answer'}
                </span>
                {/* A count only when the provider gave a countable list. An
                    absent count is left absent rather than shown as zero.
                    The separator is not decoration: without it a status and a
                    count sit adjacent, and "200" beside "4 records" reads as
                    "2004 records" the moment the line is copied anywhere. */}
                {area.ok && area.count !== null ? (
                  <span className="text-ink-muted">
                    · {area.count} {area.count === 1 ? 'record' : 'records'}
                  </span>
                ) : null}
                {area.detail ? <span className="text-ink-muted">·</span> : null}
                {area.detail ? <span className="text-ink-muted">{area.detail}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
