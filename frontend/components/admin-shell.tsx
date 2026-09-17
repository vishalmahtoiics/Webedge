import Link from 'next/link';
import { redirect } from 'next/navigation';
import { logout } from '@/lib/api';

const NAV = [
  { href: '/admin/dashboard', label: 'Overview' },
  { href: '/admin/customers', label: 'Customers' },
  { href: '/admin/providers', label: 'Infrastructure' },
  { href: '/admin/billing', label: 'Billing' },
];

/**
 * The staff shell.
 *
 * Visually distinct from the customer portal — dark header, different accent —
 * because staff move between the two and a page that looks identical in both is
 * how someone runs a staff action believing they are in a customer's account.
 */
export function AdminShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  async function signOut() {
    'use server';
    await logout('admin');
    redirect('/admin/login');
  }

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between gap-4 border-b border-harbor/20 bg-harbor px-5 text-white">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <span className="h-4 w-0.5 rounded-sm bg-edge" aria-hidden="true" />
            <span className="text-sm font-semibold tracking-tight">WebEdge Admin</span>
          </div>
          <nav className="hidden gap-4 sm:flex">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="text-sm text-white/70 hover:text-white">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <form action={signOut}>
          <button type="submit" className="text-sm text-white/70 hover:text-white">
            Sign out
          </button>
        </form>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description ? <p className="mt-1.5 text-sm text-ink-muted">{description}</p> : null}
          </div>
          {actions}
        </div>
        <div className="mt-8">{children}</div>
      </main>
    </div>
  );
}
