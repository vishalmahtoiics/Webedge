import { redirect } from 'next/navigation';
import { LoginForm, type LoginState } from '@/components/login-form';
import { login } from '@/lib/api';

export default function CustomerLoginPage() {
  async function action(_state: LoginState, formData: FormData): Promise<LoginState> {
    'use server';

    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');
    if (!email || !password) return { error: 'Enter your email address and password.', email };

    const result = await login('customer', email, password);
    // The backend returns one generic message for wrong password, unknown
    // account, locked and suspended alike; surfacing it verbatim keeps the
    // portal from leaking which case it was.
    if (!result.ok) return { error: result.error.message, email };

    redirect('/dashboard');
  }

  return (
    <LoginForm
      action={action}
      variant="customer"
      heading="Sign in"
      subheading="Manage your hosting, domains and email."
    />
  );
}
