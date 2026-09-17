'use client';

import { useActionState } from 'react';

export type FormState = { error?: string; success?: string };

const field =
  'h-10 rounded-lg border border-line-input bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30';

const button =
  'h-10 shrink-0 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60';

function Message({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <p
        role="alert"
        className="rounded-lg border border-state-danger/30 bg-state-danger/5 px-3 py-2.5 text-sm text-state-danger"
      >
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="rounded-lg border border-state-success/30 bg-state-success/5 px-3 py-2.5 text-sm text-state-success">
        {state.success}
      </p>
    );
  }
  return null;
}

export function AddDomainForm({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <Message state={state} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Domain</span>
          <input name="name" placeholder="example.com" className={`${field} w-72`} />
        </label>
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Adding…' : 'Add domain'}
        </button>
      </div>
      <p className="text-sm text-ink-muted">
        You will be asked to publish a DNS record proving the domain is yours before it can
        receive mail.
      </p>
    </form>
  );
}

export function AddMailboxForm({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <Message state={state} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Address</span>
          <input name="localPart" placeholder="asha" className={`${field} w-40`} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            className={`${field} w-56`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Quota (MB)</span>
          <input name="quotaMib" inputMode="numeric" placeholder="2048" className={`${field} w-28`} />
        </label>
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Creating…' : 'Create mailbox'}
        </button>
      </div>
      {/* Said before submitting rather than as a rejection afterwards. */}
      <p className="text-sm text-ink-muted">
        At least 12 characters. The password cannot be shown again — it is stored hashed, and a
        forgotten one is reset rather than retrieved.
      </p>
    </form>
  );
}

export function AddAliasForm({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      <Message state={state} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Address</span>
          <input name="localPart" placeholder="sales" className={`${field} w-40`} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Forwards to</span>
          <input
            name="destinations"
            placeholder="asha@example.com, vikram@example.com"
            className={`${field} w-96`}
          />
        </label>
        <button type="submit" disabled={pending} className={button}>
          {pending ? 'Creating…' : 'Create alias'}
        </button>
      </div>
      <p className="text-sm text-ink-muted">
        Separate several destinations with commas. Use <code>*</code> as the address to catch
        everything not matched by a mailbox or another alias.
      </p>
    </form>
  );
}

export function VerifyDomainButton({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <Message state={state} />
      <button type="submit" disabled={pending} className={`${button} self-start`}>
        {pending ? 'Checking DNS…' : 'Check the record'}
      </button>
    </form>
  );
}
