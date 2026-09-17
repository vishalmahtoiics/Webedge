import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { logout } from '@/lib/api';

export default async function AdminDashboard() {
  const { accessToken, refreshToken } = await getSession('admin');
  if (!accessToken && !refreshToken) redirect('/admin/login');

  async function signOut() {
    'use server';
    await logout('admin');
    redirect('/admin/login');
  }

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between border-b border-harbor/20 bg-harbor px-5 text-white">
        <div className="flex items-center gap-2.5">
          <span className="h-4 w-0.5 rounded-sm bg-edge" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">WebEdge Admin</span>
        </div>
        <form action={signOut}>
          <button type="submit" className="text-sm text-white/70 hover:text-white">
            Sign out
          </button>
        </form>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1.5 text-sm text-ink-muted">Customers, provider accounts and system health.</p>

        <div className="mt-8 rounded-xl border border-line bg-white p-6">
          <h2 className="text-base font-semibold">Phase 1</h2>
          <p className="mt-1.5 max-w-prose text-sm text-ink-muted">
            Authentication and role-based access control are in place. Customer management and provider
            accounts arrive in Phase 2.
          </p>
        </div>
      </main>
    </div>
  );
}
