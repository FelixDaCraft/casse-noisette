import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getCurrentAdmin()) redirect('/admin');
  return (
    <div className="login-wrap">
      <LoginForm />
    </div>
  );
}
