import Link from 'next/link';
import ResetForm from './ResetForm';

export const dynamic = 'force-dynamic';

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <p className="err">Lien invalide.</p>
          <p>
            <Link href="/admin/forgot" className="muted">
              Demander un nouveau lien
            </Link>
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="login-wrap">
      <ResetForm token={token} />
    </div>
  );
}
