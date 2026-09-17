import Link from 'next/link';
import { logout } from '@/lib/api';
import { redirect } from 'next/navigation';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/domains', label: 'Domains' },
];

export function PortalShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  async function signOut() {
    'use server';
    await logout('customer');
    redirect('/login');
  }

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between gap-4 border-b border-line bg-white px-5">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <span className="h-4 w-0.5 rounded-sm bg-primary" aria-hidden="true" />
            <span className="text-sm font-semibold tracking-tight">WebEdge Solution</span>
          </div>
          <nav className="hidden gap-4 sm:flex">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="text-sm text-ink-muted hover:text-ink">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <form action={signOut}>
          <button type="submit" className="text-sm text-ink-muted hover:text-ink">
            Sign out
          </button>
        </form>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1.5 text-sm text-ink-muted">{description}</p> : null}
        <div className="mt-8">{children}</div>
      </main>
    </div>
  );
}
