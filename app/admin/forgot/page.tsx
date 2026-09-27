import ForgotForm from './ForgotForm';
import AuthShell from '../AuthShell';

export const dynamic = 'force-dynamic';

export default function ForgotPage() {
  return (
    <AuthShell>
      <ForgotForm />
    </AuthShell>
  );
}
