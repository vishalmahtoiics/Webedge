import { redirect } from 'next/navigation';
import { LoginForm, type LoginState } from '@/components/login-form';
import { login } from '@/lib/api';

export default function AdminLoginPage() {
  async function action(_state: LoginState, formData: FormData): Promise<LoginState> {
    'use server';

    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');
    if (!email || !password) return { error: 'Enter your email address and password.', email };

    const result = await login('admin', email, password);
    if (!result.ok) return { error: result.error.message, email };

    redirect('/admin/dashboard');
  }

  return (
    <LoginForm
      action={action}
      variant="admin"
      heading="Staff sign-in"
      subheading="WebEdge Solution administration."
    />
  );
}
