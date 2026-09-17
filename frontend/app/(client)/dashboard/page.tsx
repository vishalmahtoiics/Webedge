import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { logout } from '@/lib/api';

export default async function CustomerDashboard() {
  const { accessToken, refreshToken } = await getSession('customer');
  // No session at all means never signed in; the API client handles expiry.
  if (!accessToken && !refreshToken) redirect('/login');

  async function signOut() {
    'use server';
    await logout('customer');
    redirect('/login');
  }

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between border-b border-line bg-white px-5">
        <div className="flex items-center gap-2.5">
          <span className="h-4 w-0.5 rounded-sm bg-primary" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight">WebEdge Solution</span>
        </div>
        <form action={signOut}>
          <button type="submit" className="text-sm text-ink-muted hover:text-ink">
            Sign out
          </button>
        </form>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          Manage your websites, domains, email and hosting resources from one place.
        </p>

        <div className="mt-8 rounded-xl border border-line bg-white p-6">
          <h2 className="text-base font-semibold">No services yet</h2>
          <p className="mt-1.5 max-w-prose text-sm text-ink-muted">
            Hosting resources appear here once a plan is assigned to your account. Website, domain and
            email modules arrive in Phase 3.
          </p>
        </div>
      </main>
    </div>
  );
}
