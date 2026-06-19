import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  if (await getCurrentAdmin()) redirect('/admin');
  const { reset } = await searchParams;
  return (
    <div className="login-wrap">
      <LoginForm resetDone={reset === '1'} />
    </div>
  );
}
