'use client';

import { useRef, useState, useTransition } from 'react';

type Result = { ok: true } | { ok: false; message: string };
type Customer = { id: string; name: string };

const field =
  'w-full rounded-lg border border-line px-3 py-2 text-sm ring-focus focus:border-ink';
const label = 'block text-sm font-medium';
const hint = 'mt-1 text-xs text-ink-muted';
const primary =
  'tap ring-focus rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50';
const secondary =
  'tap ring-focus rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-ink disabled:opacity-50';

/**
 * Attaching a domain found on a provider account to a customer.
 *
 * The confirmation names both the domain and the customer. "Are you sure?"
 * is not a safeguard here: attaching the wrong domain hands one person control
 * of another's DNS, and there is nothing downstream that can undo it — every
 * later query will agree the row is theirs.
 */
export function AssignDomainButton({
  discoveredId,
  domainName,
  customers,
  action,
}: {
  discoveredId: string;
  domainName: string;
  customers: Customer[];
  action: (discoveredId: string, customerId: string) => Promise<Result>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [customerId, setCustomerId] = useState('');

  if (customers.length === 0) {
    return (
      <span className="text-xs text-ink-muted">No customers yet</span>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${secondary} px-2.5 py-1 text-xs`}>
        Assign
      </button>
    );
  }

  const chosen = customers.find((c) => c.id === customerId);

  return (
    <div className="animate-sheet-in flex flex-col gap-2 rounded-lg border border-line bg-canvas p-3 text-left">
      <label className={label} htmlFor={`assign-${discoveredId}`}>
        Assign {domainName} to
      </label>
      <select
        id={`assign-${discoveredId}`}
        value={customerId}
        onChange={(event) => setCustomerId(event.target.value)}
        className={field}
      >
        <option value="">Choose a customer…</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.name}
          </option>
        ))}
      </select>

      {error ? (
        <p role="alert" className="animate-fade-in rounded-lg border border-state-danger/30 bg-state-danger/5 p-2 text-xs text-state-danger">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || customerId === ''}
          onClick={() => {
            if (!chosen) return;
            if (
              !confirm(
                `Assign ${domainName} to ${chosen.name}?\n\n` +
                  'They will control its DNS. Moving a domain between customers later does not ' +
                  'undo records that are already live.',
              )
            ) {
              return;
            }
            setError(null);
            startTransition(async () => {
              const result = await action(discoveredId, customerId);
              if (result.ok) setOpen(false);
              else setError(result.message);
            });
          }}
          className={`${primary} px-2.5 py-1 text-xs`}
        >
          {pending ? 'Assigning…' : 'Assign'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          className={`${secondary} px-2.5 py-1 text-xs`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Adds a domain registered somewhere other than a connected account. */
export function AddDomainForm({
  customers,
  action,
}: {
  customers: Customer[];
  action: (input: {
    name: string;
    customerId: string;
    expiresAt?: string;
    registrar?: string;
    dnsManaged?: boolean;
  }) => Promise<Result>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={primary}>
        Add a domain
      </button>
    );
  }

  return (
    <form
      ref={form}
      className="animate-sheet-in flex flex-col gap-4 rounded-xl border border-line bg-white p-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await action({
            name: String(data.get('name') ?? '').trim(),
            customerId: String(data.get('customerId') ?? ''),
            expiresAt: String(data.get('expiresAt') ?? '') || undefined,
            registrar: String(data.get('registrar') ?? '').trim() || undefined,
            dnsManaged: data.get('dnsManaged') === 'on',
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
      <h2 className="text-base font-semibold">Add a domain</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="name">Domain name</label>
          <input id="name" name="name" required placeholder="example.com" className={field} />
          <p className={hint}>For a domain registered elsewhere. One already on a connected account should be assigned instead.</p>
        </div>

        <div>
          <label className={label} htmlFor="customerId">Customer</label>
          <select id="customerId" name="customerId" required defaultValue="" className={field}>
            <option value="" disabled>Choose a customer…</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.name}</option>
            ))}
          </select>
          <p className={hint}>Required. A domain always belongs to someone.</p>
        </div>

        <div>
          <label className={label} htmlFor="registrar">Registrar</label>
          <input id="registrar" name="registrar" className={field} />
        </div>

        <div>
          <label className={label} htmlFor="expiresAt">Expires</label>
          <input id="expiresAt" name="expiresAt" type="date" className={field} />
          <p className={hint}>Leave empty if unknown — it then reads as absent rather than as a guess.</p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="dnsManaged" className="rounded border-line" />
        Manage this domain&rsquo;s DNS in WebEdge
      </label>

      {error ? (
        <p role="alert" className="animate-fade-in rounded-lg border border-state-danger/30 bg-state-danger/5 p-3 text-sm text-state-danger">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? 'Adding…' : 'Add domain'}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} className={secondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}
