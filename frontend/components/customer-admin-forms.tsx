'use client';

import { useRef, useState, useTransition } from 'react';

const field = 'w-full rounded-lg border border-line px-3 py-2 text-sm ring-focus focus:border-ink';
const label = 'block text-sm font-medium';
const hint = 'mt-1 text-xs text-ink-muted';
const primary =
  'tap ring-focus rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50';
const secondary =
  'tap ring-focus rounded-lg border border-line px-3 py-2 text-sm font-medium hover:border-ink disabled:opacity-50';

type AddUserResult =
  | { ok: true; temporaryPassword?: string }
  | { ok: false; message: string };

/**
 * Adds another login to a customer.
 *
 * The generated password is shown once, here, and nowhere else — it is stored
 * only as a hash and is deliberately absent from the audit trail, which is
 * append-only and could never have it removed. So the screen says plainly that
 * this is the only time it will be visible.
 */
export function AddUserForm({
  action,
}: {
  action: (input: { fullName: string; email: string }) => Promise<AddUserResult>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  if (password !== null) {
    return (
      <div className="animate-sheet-in rounded-xl border border-state-success/30 bg-state-success/5 p-4">
        <p className="text-sm font-medium">User added. This password is shown once.</p>
        <p className="mt-2 select-all break-all rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm">
          {password}
        </p>
        <p className={hint}>
          Copy it now. WebEdge stores only a hash, so nobody — including you — can read it back.
        </p>
        <button type="button" onClick={() => { setPassword(null); setOpen(false); }} className={`${secondary} mt-3`}>
          Done
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={secondary}>
        Add a user
      </button>
    );
  }

  return (
    <form
      ref={form}
      className="animate-sheet-in flex flex-col gap-3 rounded-xl border border-line bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          const result = await action({
            fullName: String(data.get('fullName') ?? '').trim(),
            email: String(data.get('email') ?? '').trim(),
          });
          if (result.ok) {
            form.current?.reset();
            setPassword(result.temporaryPassword ?? null);
            if (!result.temporaryPassword) setOpen(false);
          } else {
            setError(result.message);
          }
        });
      }}
    >
      <p className="text-sm font-medium">Add a user</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="userFullName">Full name</label>
          <input id="userFullName" name="fullName" required minLength={2} className={field} />
        </div>
        <div>
          <label className={label} htmlFor="userEmail">Email address</label>
          <input id="userEmail" name="email" type="email" required className={field} />
          <p className={hint}>They sign in with this. A password is generated and shown once.</p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="animate-fade-in rounded-lg border border-state-danger/30 bg-state-danger/5 p-3 text-sm text-state-danger">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={primary}>
          {pending ? 'Adding…' : 'Add user'}
        </button>
        <button type="button" onClick={() => { setOpen(false); setError(null); }} className={secondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}

type Database = { name: string; user: string | null };

/**
 * Databases on a website's provider account.
 *
 * Creating one is a write to a live account, and deleting one removes real
 * data that nothing here can restore — so the delete confirmation names the
 * database and says the data goes with it, rather than asking whether the
 * person is sure.
 */
export function DatabasePanel({
  websiteId,
  websiteDomain,
  list,
  create,
  remove,
  phpMyAdmin,
}: {
  websiteId: string;
  websiteDomain: string;
  list: (websiteId: string) => Promise<{ ok: true; items: Database[] } | { ok: false; message: string }>;
  create: (
    websiteId: string,
    input: { name: string; user: string; password: string },
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  remove: (websiteId: string, name: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  phpMyAdmin: (
    websiteId: string,
    name: string,
  ) => Promise<{ ok: true; link: string } | { ok: false; message: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Database[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);

  function load() {
    startTransition(async () => {
      const result = await list(websiteId);
      if (result.ok) { setLoaded(result.items); setError(null); }
      else { setLoaded(null); setError(result.message); }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); load(); }}
        className={`${secondary} px-2.5 py-1 text-xs`}
      >
        Databases
      </button>
    );
  }

  return (
    <div className="animate-sheet-in mt-3 w-full rounded-lg border border-line bg-canvas p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Databases · {websiteDomain}</p>
        <button type="button" onClick={() => setOpen(false)} className={`${secondary} px-2 py-1 text-xs`}>
          Close
        </button>
      </div>

      {pending && loaded === null ? (
        <div className="mt-3 space-y-2">
          <div className="skeleton h-8 w-full" />
          <div className="skeleton h-8 w-4/5" />
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="animate-fade-in mt-3 rounded-lg border border-state-danger/30 bg-state-danger/5 p-3 text-sm text-state-danger">
          {error}
        </p>
      ) : null}

      {loaded !== null ? (
        loaded.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">No databases on this website.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
            {loaded.map((database) => (
              <li key={database.name} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm">{database.name}</p>
                  {database.user ? (
                    <p className="truncate text-xs text-ink-muted">user {database.user}</p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      startTransition(async () => {
                        const result = await phpMyAdmin(websiteId, database.name);
                        if (result.ok) window.open(result.link, '_blank', 'noopener,noreferrer');
                        else setError(result.message);
                      });
                    }}
                    className={`${secondary} px-2 py-1 text-xs`}
                  >
                    phpMyAdmin
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        !confirm(
                          `Delete the database ${database.name}?\n\n` +
                            'Everything in it goes with it. WebEdge keeps no copy and this cannot be undone.',
                        )
                      ) return;
                      startTransition(async () => {
                        const result = await remove(websiteId, database.name);
                        if (result.ok) load();
                        else setError(result.message);
                      });
                    }}
                    className="tap ring-focus rounded-lg border border-line px-2 py-1 text-xs text-ink-muted hover:border-state-danger hover:text-state-danger"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {adding ? (
        <form
          ref={form}
          className="animate-sheet-in mt-3 flex flex-col gap-3 rounded-lg border border-line bg-white p-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const data = new FormData(event.currentTarget);
            startTransition(async () => {
              const result = await create(websiteId, {
                name: String(data.get('dbName') ?? '').trim(),
                user: String(data.get('dbUser') ?? '').trim(),
                password: String(data.get('dbPassword') ?? ''),
              });
              if (result.ok) { form.current?.reset(); setAdding(false); load(); }
              else setError(result.message);
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={label} htmlFor={`dbName-${websiteId}`}>Name</label>
              <input id={`dbName-${websiteId}`} name="dbName" required minLength={3} className={field} />
            </div>
            <div>
              <label className={label} htmlFor={`dbUser-${websiteId}`}>User</label>
              <input id={`dbUser-${websiteId}`} name="dbUser" required minLength={3} className={field} />
            </div>
            <div>
              <label className={label} htmlFor={`dbPassword-${websiteId}`}>Password</label>
              <input
                id={`dbPassword-${websiteId}`}
                name="dbPassword"
                type="password"
                required
                minLength={12}
                autoComplete="off"
                className={field}
              />
            </div>
          </div>
          <p className={hint}>
            The provider adds the account username as a prefix to both the name and the user.
          </p>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className={`${primary} px-2.5 py-1 text-xs`}>
              {pending ? 'Creating…' : 'Create database'}
            </button>
            <button type="button" onClick={() => setAdding(false)} className={`${secondary} px-2.5 py-1 text-xs`}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={`${secondary} mt-3 px-2.5 py-1 text-xs`}>
          New database
        </button>
      )}
    </div>
  );
}
