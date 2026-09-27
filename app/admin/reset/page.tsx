import Link from 'next/link';
import ResetForm from './ResetForm';
import AuthShell from '../AuthShell';

export const dynamic = 'force-dynamic';

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <AuthShell>
        <h2>Lien invalide</h2>
        <p className="sous">Ce lien a expiré ou a déjà servi.</p>
        <Link href="/admin/forgot" className="lien-sobre">
          Demander un nouveau lien
        </Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell>
      <ResetForm token={token} />
    </AuthShell>
  );
}
