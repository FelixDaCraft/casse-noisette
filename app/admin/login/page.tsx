import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/auth';
import LoginForm from './LoginForm';
import AuthShell from '../AuthShell';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  if (await getCurrentAdmin()) redirect('/admin');
  const { reset } = await searchParams;
  return (
    <AuthShell>
      <LoginForm resetDone={reset === '1'} />
    </AuthShell>
  );
}
