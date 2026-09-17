'use client';

import { useActionState, useState } from 'react';

export type RecordFormState = {
  error?: string;
  success?: string;
  fields?: Record<string, string>;
  values?: Record<string, unknown>;
};

const TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'NS', 'CAA'] as const;

const TTL_PRESETS = [
  { label: 'Auto (4 hours)', value: 14400 },
  { label: '5 minutes', value: 300 },
  { label: '1 hour', value: 3600 },
  { label: '1 day', value: 86400 },
];

/** Per-type help, so the customer knows what a field wants before submitting. */
const HELP: Record<string, { value: string; name: string }> = {
  A: { value: 'An IPv4 address, such as 203.0.113.10.', name: 'Use @ for the domain itself, or a name like www.' },
  AAAA: { value: 'An IPv6 address, such as 2001:db8::1.', name: 'Use @ for the domain itself.' },
  CNAME: { value: 'The hostname this should point to.', name: 'Cannot be @ — use an A record at the root.' },
  MX: { value: 'The mail server hostname. Set the priority separately.', name: 'Usually @.' },
  TXT: { value: 'The text value, such as an SPF or verification string.', name: 'Use @, or _dmarc for DMARC.' },
  SRV: { value: 'The target hostname.', name: 'Looks like _service._tcp, for example _sip._tls.' },
  NS: { value: 'The nameserver hostname.', name: 'The subdomain to delegate. Cannot be @.' },
  CAA: { value: 'For example: 0 issue "letsencrypt.org".', name: 'Usually @.' },
};

const field =
  'h-10 rounded-lg border bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30';

export function AddRecordForm({
  action,
}: {
  action: (state: RecordFormState, formData: FormData) => Promise<RecordFormState>;
}) {
  const [state, formAction, pending] = useActionState<RecordFormState, FormData>(action, {});
  const [type, setType] = useState<string>('A');

  const err = (name: string) => state.fields?.[name];
  const border = (name: string) => (err(name) ? 'border-state-danger' : 'border-line-input');
  const help = HELP[type] ?? HELP.A!;

  // Only the types that use them, so the form does not show four empty boxes
  // for an A record.
  const needsPriority = type === 'MX' || type === 'SRV';
  const needsSrvExtras = type === 'SRV';

  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <h2 className="text-sm font-semibold">Add a record</h2>

      <form action={formAction} className="mt-4 flex flex-col gap-4" noValidate>
        {state.error ? (
          <div role="alert" data-testid="dns-error" className="rounded-lg border border-state-danger/30 bg-state-danger/5 px-3 py-2.5 text-sm text-state-danger">
            {state.error}
          </div>
        ) : null}
        {state.success ? (
          <div role="status" data-testid="dns-success" className="rounded-lg border border-state-success/30 bg-state-success/5 px-3 py-2.5 text-sm text-state-success">
            {state.success}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-[110px_1fr]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="type" className="text-sm font-medium">Type</label>
            <select
              id="type" name="type" value={type} onChange={(e) => setType(e.target.value)}
              className={`${field} border-line-input`}
            >
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-medium">Name</label>
            <input
              id="name" name="name" required defaultValue={String(state.values?.name ?? '')}
              aria-describedby="name-help" aria-invalid={Boolean(err('name'))}
              className={`${field} ${border('name')} font-mono`}
            />
            <p id="name-help" className={`text-xs ${err('name') ? 'text-state-danger' : 'text-ink-subtle'}`}>
              {err('name') ?? help.name}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="value" className="text-sm font-medium">Value</label>
          <input
            id="value" name="value" required defaultValue={String(state.values?.value ?? '')}
            aria-describedby="value-help" aria-invalid={Boolean(err('value'))}
            className={`${field} ${border('value')} font-mono`}
          />
          <p id="value-help" className={`text-xs ${err('value') ? 'text-state-danger' : 'text-ink-subtle'}`}>
            {err('value') ?? help.value}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ttl" className="text-sm font-medium">TTL</label>
            <select id="ttl" name="ttl" defaultValue={3600} className={`${field} ${border('ttl')}`}>
              {TTL_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          {needsPriority ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="priority" className="text-sm font-medium">Priority</label>
              <input id="priority" name="priority" type="number" inputMode="numeric" min={0} max={65535}
                defaultValue={String(state.values?.priority ?? 10)}
                aria-invalid={Boolean(err('priority'))}
                className={`${field} ${border('priority')} tabular-nums`} />
              {err('priority') ? <p className="text-xs text-state-danger">{err('priority')}</p> : null}
            </div>
          ) : null}

          {needsSrvExtras ? (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="weight" className="text-sm font-medium">Weight</label>
                <input id="weight" name="weight" type="number" inputMode="numeric" min={0} max={65535}
                  defaultValue={String(state.values?.weight ?? 5)}
                  className={`${field} ${border('weight')} tabular-nums`} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="port" className="text-sm font-medium">Port</label>
                <input id="port" name="port" type="number" inputMode="numeric" min={0} max={65535}
                  defaultValue={String(state.values?.port ?? '')}
                  className={`${field} ${border('port')} tabular-nums`} />
              </div>
            </>
          ) : null}
        </div>

        <button
          type="submit" disabled={pending}
          className="h-10 self-start rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-70"
        >
          {pending ? 'Adding…' : 'Add record'}
        </button>
      </form>
    </section>
  );
}
