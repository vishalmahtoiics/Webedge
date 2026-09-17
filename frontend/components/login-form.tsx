'use client';

import { useActionState } from 'react';

/**
 * `email` is echoed back so a failed attempt does not wipe the field — a server
 * action re-renders the form and uncontrolled inputs reset, which otherwise
 * makes the user retype their address on every mistyped password. The password
 * is deliberately never echoed back.
 */
export type LoginState = { error?: string; email?: string };

type Props = {
  action: (state: LoginState, formData: FormData) => Promise<LoginState>;
  heading: string;
  subheading: string;
  /** Staff sign-in is visually distinct so nobody types customer credentials into it. */
  variant: 'customer' | 'admin';
};

export function LoginForm({ action, heading, subheading, variant }: Props) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(action, {});
  const isAdmin = variant === 'admin';

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <span className={`h-5 w-0.5 rounded-sm ${isAdmin ? 'bg-edge' : 'bg-primary'}`} aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">WebEdge Solution</span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">{heading}</h1>
        <p className="mt-1.5 text-sm text-ink-muted">{subheading}</p>

        <form action={formAction} className="mt-8 flex flex-col gap-4" noValidate>
          {state.error ? (
            // role="alert" so screen readers announce the failure rather than
            // leaving the user to discover it.
            <div
              role="alert"
              data-testid="form-error"
              className="rounded-lg border border-state-danger/30 bg-state-danger/5 px-3 py-2.5 text-sm text-state-danger"
            >
              {state.error}
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="username"
              inputMode="email"
              autoFocus
              defaultValue={state.email ?? ''}
              className="h-10 rounded-lg border border-line-input bg-white px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="h-10 rounded-lg border border-line-input bg-white px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </div>

          <button
            type="submit"
            disabled={pending}
            className="mt-2 h-10 rounded-lg bg-primary text-sm font-medium text-white transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-70"
          >
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
